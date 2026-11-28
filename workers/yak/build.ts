// A space's Operator's object: one Durable Object per space, named by its
// eid, holding the Operator's store (operator-store.ts) and running its work
// (operator.ts), with the pages watching it on WebSockets. The class keeps
// its first name, Builder, which the Worker's binding and every object
// already made are known by.
import type { OperatorStore } from './operator-store.ts'
import type { Press } from './operator-approvals.ts'
import type { Bundle } from '@yaks/graph'
import type { Hibernation, Wire } from '@yaks/durable-object'
import { type DurableStorage, freely } from '@yaks/durable-object/sql'
import { type Alarms, RETRY } from '@yaks/durable-object/alarm'
import { Durable, type Spec } from '@yaks/durable-object/object'
import { once } from '@yaks/fp'
import { type Level, writes } from '@yaks/member'
import { directory } from './directory.ts'
import { onceRead, restart, type Restartable } from './running.ts'
import * as dirPart from './directory.ts'
import type { Settings } from './operator-settings.ts'
import type { Env } from './env.ts'
import { caught, refusing, stopped } from './defects.ts'
import { refuse } from '@yaks/api/refuse'
import { elapsed, hop, reported, type Tally, tallying } from './lib/hops.ts'
import { headed } from '@yaks/workerd/upgrade'
import { type Browsers, browsers, type Lent } from './operator-browser.ts'
import { PROTOCOL, protocolled } from './protocol.ts'
import { managePath } from '@yaks/platform/routes'
import type { Handoff } from '@yaks/platform/operator-handoff'
import { HEARD, WAKE } from './door.ts'
import { type Tab, tabSaid, tabsState } from '@yaks/notify/whereabouts'
import { COPY, copying } from './store-copy.ts'
import { GRAPH, type Graphed } from './operator-graph.ts'
import { ownCommits } from './operator-commits.ts'
import { operatorVectors } from './operator-vectors.ts'
import { type Bookmarked, bookmarks, RESTORING } from './bookmarks.ts'
import {
  NOBODY,
  NOT_A_WRITER,
  OWED,
  paged,
  SEATED,
  seatOf,
  SPACE,
  WALKTHROUGH,
} from './build-door.ts'
import { keyed, keysOn } from './platform-keys.ts'

/**
 * The slice of a `DurableObjectState` this object needs: its SQLite, and its
 * hibernatable sockets. A Worker's own `DurableObjectState` satisfies it —
 * both halves are @yaks/durable-object's own types, and its `conform.ts` is
 * where they are held to the runtime's.
 *
 * This class is NOT in workers/yak/conform.ts beside the Store, and cannot be:
 * it runs the Operator, so the whole kernel is in its module graph, and that gate
 * is checked with no Deno anywhere in scope (door.ts). What is Cloudflare's
 * here is the socket slice above, which is checked where it is declared.
 */
export type State = Hibernation & Restartable & {
  storage: DurableStorage & {
    // The one way to empty an object: dropping the tables leaves metadata
    // behind, and an object whose storage is empty ceases to exist. It is what
    // a deleted space's conversation goes through ({@link Builder.wipe}), the
    // same call the Store makes for the same reason (graph.ts).
    deleteAll(): Promise<void>
  } & Alarms
  // Work still going after an answer or an alarm returns: an object's own
  // keeps it running, and a test's platform waits on it (`settled`).
  waitUntil?(work: Promise<unknown>): void
}

// What a page reading the Operator's store says of its tab (@yaks/notify
// `tabSaid`), none for any other frame.
let tabOf = (data: string | ArrayBuffer): Tab | undefined => {
  try {
    return tabSaid(JSON.parse(String(data)))
  } catch { /* not a tab's say */ }
}

// Who is at a socket of the Operator's own: a browser lent to it
// (operator-browser.ts).
type Socket = Lent
// A page reading the Operator's store (operator-api.ts), and where its tab
// is, once it said.
type Paged = { read?: { person?: string }; tab?: Tab }

export class Builder extends Durable {
  #ctx: State
  #env: Env
  #operator?: Promise<import('./operator.ts').Operator>
  // What a read of the Operator needs, made without it (`#stored`), and its
  // store's @yaks/api door (operator-api.ts).
  #store?: Promise<
    Pick<import('./operator.ts').Operator, 'store' | 'named'> & {
      door: ReturnType<typeof import('./operator-api.ts').operatorApi>
    }
  >
  // What the pages watching the Operator are told, once it is at work.
  #frames?: ReturnType<typeof import('./operator-host.ts').operatorFrames>
  #arming?: Promise<void>
  #revivals = 0
  // When the Operator's work stops starting runs (the alarm's slice),
  // and whether the alarm's drain is working it: beside a drain a write's
  // work starts only within the drain's slice, so the drain ends; otherwise
  // it opens a slice of its own, and the alarm it arms takes up what that
  // leaves.
  #until = 0
  #draining = false
  // What this incarnation takes up from the one before it (`#stored`), on a
  // wake or its alarm, which nobody waits on: every answer it gives meanwhile
  // says so (build-door.ts `OWED`), and its caller wakes it once it has the
  // answer.
  #owed?: () => void
  // The answers this incarnation is giving now, until each has been read.
  #asked = 0
  // The browsers people lend the Operator, and the calls asked of them that
  // wait for an answer: in memory, as the step waiting on one is.
  #lent: Browsers

  constructor(ctx: State, env: Env) {
    // What it opens is the Operator, whose works its alarm runs; what its
    // statements may cost before it stops until a window ends is its
    // storage's ceiling.
    super(ctx)
    this.#ctx = ctx
    this.ceiling
    // The Operator holds the overlay while it works so it sees refreshed
    // provider keys. Reads of its store need only the Worker bindings.
    this.#env = keysOn(env)
    this.#lent = browsers(
      () => ctx.getWebSockets(),
      (held) => this.#writes(held),
      env.CLOCK,
    )
  }

  /**
   * The Operator's store, gone, and the object born again on the spot
   * (T-34371). This is what a deleted space takes with it: what its Operator
   * keeps lives in this object's own SQLite and nowhere else, so the directory
   * tombstone that buries every app, deploy and membership of the space
   * cannot reach it — `/privacy` says a closed space takes its things with it,
   * and erase.ts calls this so the sentence is true.
   *
   * Idempotent, because a delete that died halfway is finished by asking
   * again (erase.ts order): emptying an empty object empties it again.
   *
   * The incarnation ends with it once `/wipe` has answered: what it opened
   * (the Operator's store, the alarm's works, a step under way) holds a
   * driver that knew the file before `deleteAll`, and would go on reading
   * tables that are gone ("no such table: server_meta", T-222). Its alarm
   * goes too, so no incarnation wakes to plant a store for a space that no
   * longer exists. A stand-in that cannot restart forgets what it opened here
   * instead.
   *
   * The sockets are left where they are: a page still holding one is watching
   * a space that no longer exists, and its next request is refused there.
   */
  async wipe() {
    let ctx = this.#ctx
    this.#owed = undefined
    await ctx.storage.deleteAlarm?.()
    await ctx.storage.deleteAll()
    this.#operator = undefined
    this.#store = undefined
    this.#frames = undefined
  }

  /**
   * The object's door: the Operator's requests, its pages' sockets, and the
   * wipe a space's death asks for. Who is asking is the kernel's word (the
   * kernel vouches it the way it vouches a store request): this object is
   * never reached from the internet. An answer carries what its work cost the
   * caller's Server-Timing: the round trips and waits behind it, as a store's
   * carries them (hops.ts `reported`, door.ts `metered`).
   */
  override async fetch(request: Request): Promise<Response> {
    let tally: Tally = new Map()
    this.#asked++
    let answer
    try {
      answer = await tallying(tally, () => this.#answer(request))
    } catch (e) {
      // An object past the rows it may read or write (@yaks/durable-object
      // `bounded`) answers how long to wait, at whichever door met it.
      if (!stopped(e)) {
        this.#gone()
        throw e
      }
      answer = refuse(e)
    }
    let headers = new Headers(answer.headers)
    for (let [name, value] of Object.entries(reported(tally))) {
      headers.set(name, value)
    }
    if (this.#owed) headers.set(OWED, '1')
    // Under way until its caller has read it (`onceRead`).
    return onceRead(headed(answer, headers), () => this.#gone())
  }

  #gone() {
    this.#asked--
  }

  async #answer(request: Request): Promise<Response> {
    let url = new URL(request.url)
    if (url.pathname == WAKE) {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      await this.#stored()
      // Nobody waits on this answer, so what the incarnation owes goes on
      // behind it; beside another answer still under way, whose caller wakes
      // this object again once it has that answer (`OWED`), it waits for that
      // wake.
      if (this.#asked == 1) this.#resume()
      return new Response(null, { status: 204 })
    }
    // An app a subscription watches committed (graph.ts `#herald`): each
    // subscription over the space looks again a beat later. Nobody watching
    // the space is said with 410, so the app stops telling.
    if (url.pathname == HEARD && request.method == 'POST') {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      let { store } = await this.#stored()
      let { heard } = await import('./operator-schedules.ts')
      let at = await heard(store, false)
      if (at != null) await this.clock.arm(at)
      return new Response(null, { status: at == null ? 410 : 204 })
    }
    // A seat in the space moved (directory-graph.ts `seatsHeard`): what
    // reads its members looks again, as on `HEARD`, and each page's socket
    // holds its person's seat as it is now. A socket never reads its seat
    // on a frame, so this is how one taken away closes it.
    if (url.pathname == SEATED && request.method == 'POST') {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      let { store, door } = await this.#stored()
      let { heard } = await import('./operator-schedules.ts')
      let [at] = await Promise.all([heard(store, false), door.reseat()])
      if (at != null) await this.clock.arm(at)
      return new Response(null, { status: 204 })
    }
    if (url.pathname == '/revive') {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      this.#revivals++
      await this.clock.arm(Date.now())
      return new Response(null, { status: 204 })
    }
    if (url.pathname == '/wipe') {
      // Nobody's but the kernel's, and no person's at all: the space is being
      // deleted and there may be no membership left to read. The header cannot
      // arrive from outside — `joining` strips it from the request it carries
      // over, the way door.ts strips it at a store's door.
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      await this.wipe()
      // Restarted before the kernel has its answer, the object fails the
      // wipe that asked, and the space's deletion with it.
      return onceRead(
        Response.json({ ok: true }),
        () => restart(this.#ctx, WIPED),
      )
    }
    // Where the Operator's storage is, and putting it back there
    // (bookmarks.ts, recover.ts): store_restore with `operator`. The kernel's
    // alone, as an app store's is.
    if (url.pathname == '/restore') {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      return bookmarks(
        this.#ctx.storage as Bookmarked,
        request,
        `operator ${request.headers.get(SPACE) ?? ''}`,
      )
    }
    // The restart that wakes a restored object at its bookmark: this request
    // is failed by it, and the caller reads that as done (recover.ts).
    if (url.pathname == '/restart' && request.method == 'POST') {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      restart(this.#ctx, RESTORING)
      return Response.json({ ok: true })
    }
    if (url.pathname == COPY) {
      // The platform's admin's, through the kernel (sweep.ts): a read of the
      // file as it stands, made by no Operator, counted and never stopped.
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      return copying(freely(this.#ctx.storage), await request.json())
    }
    // The platform's admin reading or writing the Operator's store, through
    // the kernel (sweep.ts `graphing`): a query, or bundles applied as the
    // admin, through the store's own rules, journal and trash.
    if (url.pathname == GRAPH) {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      let asked = await request.json() as Graphed
      let { store } = await this.#stored()
      try {
        if (asked.bundles) {
          let by = { by: asked.by }
          return Response.json(
            await store.g.apply(
              asked.bundles.map((b) => ({ ...b, $actor: by })),
              { check: asked.check },
            ),
          )
        }
        let { whole } = await import('@yaks/query')
        return Response.json(await store.g.read(whole(asked.q ?? '')))
      } catch (error) {
        if (stopped(error)) throw error
        return no(
          refusing(error, { request: 'operator graph' }),
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    // What a published skill's rounds measured, for its public page
    // (skill-page.ts): the kernel's to ask, by no person.
    if (url.pathname == '/skill/results') {
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      let space = request.headers.get(SPACE)
      if (!space) return no(403, NOBODY)
      let { results } = await import('./operator-skills.ts')
      let { store } = await this.#stored()
      let { skill } = await request.json() as { skill?: unknown }
      return Response.json(await results(store.g, String(skill ?? ''), space))
    }
    if (url.pathname.startsWith('/result/')) {
      if (
        request.headers.get('x-yak-kernel') != '1' ||
        !request.headers.get(SPACE)
      ) return no(403, NOBODY)
      let args = await request.json() as Record<string, unknown>
      if (typeof args.reader != 'string' || !args.reader) {
        return no(403, NOBODY)
      }
      let { resultRequest } = await import('./result-host.ts')
      try {
        return await resultRequest(
          (await this.#stored()).store.g,
          url.pathname.slice('/result/'.length),
          args,
          args.reader,
        ) ?? no(404, 'no result route')
      } catch (error) {
        if (stopped(error)) throw error
        return no(
          refusing(error, { request: 'result' }),
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    // The Operator's store as its page reads it, through @yaks/api
    // (operator-api.ts), asked as a person in the space, as `#operate` reads
    // them.
    if (url.pathname.startsWith('/operator/') || API.test(url.pathname)) {
      try {
        // The space this object is, as each request to its Operator names it,
        // kept by its store: what the store owes before anyone talks with its
        // Operator is paid for from it (operator-root.ts `spacedAt`).
        let named = request.headers.get(SPACE)
        if (named) {
          let { spacedAt } = await import('./operator-root.ts')
          spacedAt((await this.#stored()).store, named)
        }
        // A reply to the Operator's letter is the kernel's to bring (inbox.ts),
        // and is asked by no person.
        if (
          url.pathname == '/operator/signup' ||
          url.pathname == '/operator/inbound' ||
          url.pathname == '/operator/control' ||
          url.pathname == '/operator/receipt' ||
          url.pathname == '/operator/letter' ||
          url.pathname == '/operator/replied' ||
          url.pathname == '/operator/support' ||
          url.pathname == '/operator/tell' ||
          url.pathname == '/operator/write' ||
          url.pathname == '/operator/ask' ||
          url.pathname == '/operator/app-decision' ||
          url.pathname == '/operator/app-decision/answer' ||
          url.pathname == '/operator/rerun' ||
          url.pathname == '/operator/chat' ||
          url.pathname == '/operator/call' ||
          url.pathname == '/operator/press' ||
          url.pathname == '/operator/handoff' ||
          url.pathname == '/operator/approval' ||
          url.pathname == WALKTHROUGH
        ) {
          let space = request.headers.get(SPACE)
          if (request.headers.get('x-yak-kernel') != '1' || !space) {
            return no(403, NOBODY)
          }
          if (url.pathname == '/operator/handoff') {
            let { acceptHandoff, acceptHandoffReport } = await import(
              './operator-handoff.ts'
            )
            let { store } = await this.#stored()
            let { kind, ...message } = await request.json() as Handoff & {
              kind: string
            }
            if (kind == 'request') {
              let id = await acceptHandoff(this.#env, store, space, message)
              await this.#arming
              return Response.json({ request: id }, { status: 202 })
            }
            if (kind == 'report') {
              await acceptHandoffReport(this.#env, store, space, message)
              await this.#arming
              return Response.json({ ok: true })
            }
            if (kind == 'overview') {
              let { acceptOverview } = await import('./operator-staff.ts')
              return Response.json(
                await acceptOverview(
                  this.#env,
                  store,
                  space,
                  message as unknown as { person: string; from: string },
                ),
              )
            }
            return no(400, 'Choose a handoff request, report or overview.')
          }
          // What happened in the space, for its people's Updates
          // (operator-updates.ts `tell`).
          if (url.pathname == '/operator/tell') {
            let { notification } = await import('./operator-updates.ts')
            let { store } = await this.#stored()
            await store.g.apply([notification(await request.json())], {
              trusted: true,
            })
            return Response.json({ ok: true })
          }
          // A letter yaks.app owes a person, written by the space's Operator
          // (mail.ts `owe`).
          if (url.pathname == '/operator/write') {
            let at = await dirPart.directoryOf(this.#env.STORE).at(space)
            if (!at) return no(404, 'that space is gone')
            let { owedRows } = await import('./operator-channels.ts')
            let { store } = await this.#stored()
            let rows = owedRows(this.#env, at, await request.json())
            await store.g.apply(rows, { trusted: true })
            return Response.json({ letter: rows[1].entity.eid })
          }
          // A call's audio, its ticket sealed and opened by the kernel
          // (operator-calls.ts `streamDoor`): a caller here, or the guest
          // who stands for a voice room, who has no seat to check.
          if (url.pathname == '/operator/call') {
            let at = await dirPart.directoryOf(this.#env.STORE).at(space)
            if (!at) return no(404, 'that space is gone')
            let { answering } = await import('./operator-calls.ts')
            return answering(
              this.#env,
              await this.#work(),
              at,
              JSON.parse(request.headers.get('x-yak-call') ?? '{}'),
              () => this.#arming,
            )
          }
          // A message heard on a chat platform, from a person here or a
          // guest the kernel already told apart (chat.ts `arrived`).
          if (url.pathname == '/operator/chat') {
            let person = request.headers.get('x-yak-person')
            let at = await dirPart.directoryOf(this.#env.STORE).at(space)
            if (!person || !at) return no(404, 'that space is gone')
            let { chatHeard } = await import('./operator-channels.ts')
            let answer = await chatHeard(
              await this.#work(),
              this.#env,
              at,
              person,
              await request.json(),
            )
            await this.#arming
            return answer
          }
          // A button pressed on one of the Operator's messages in a chat
          // room, by the person whose account pressed it, if any, answered
          // for the presser alone (chat.ts `pressedOn`).
          if (url.pathname == '/operator/press') {
            let { pressAnswer } = await import('./operator-private.ts')
            let operator = await this.#work()
            let answer = await pressAnswer(
              operator.store,
              operator.approve,
              await request.json(),
            )
            await this.#arming
            return Response.json(answer)
          }
          // A link approving one act, opened or pressed, and who is signed
          // in (operator-approvals.ts `approvalDoor`).
          if (url.pathname == '/operator/approval') {
            let { approval, digest, press, decline, who } = await request
              .json() as { approval: string; digest: string } & Press
            let operator = await this.#work()
            let standing = await operator.approve(approval, digest, {
              press,
              decline,
              who,
            })
            await this.#arming
            return Response.json(standing)
          }
          // A conversation a fixed yaks.app bug stopped, taken up again
          // (operator-rerun.ts).
          if (url.pathname == '/operator/rerun') {
            let { rerun } = await import('./operator-rerun.ts')
            let { store } = await this.#stored()
            let requests = await rerun(store, space, await request.json())
            await this.#arming
            return Response.json({ requests })
          }
          // What a released draft's merge asks its person (draft-merge.ts
          // `ask`).
          if (url.pathname == '/operator/ask') {
            let { asked } = await import('./draft-merge.ts')
            let { store } = await this.#stored()
            await store.g.apply(asked(await request.json()), { trusted: true })
            return Response.json({ ok: true })
          }
          // An app's question for a person's Updates (app-decisions.ts).
          if (url.pathname == '/operator/app-decision') {
            let { askAppDecision } = await import(
              '@yaks/platform/app-decision'
            )
            let { store } = await this.#stored()
            await askAppDecision(store.g, await request.json())
            return Response.json({ ok: true })
          }
          if (url.pathname == '/operator/app-decision/answer') {
            let { keepAppAnswer } = await import('@yaks/platform/app-decision')
            let { store } = await this.#stored()
            await keepAppAnswer(store.g, await request.json())
            return Response.json({ ok: true })
          }
          if (url.pathname == '/operator/receipt') {
            let { operatorReceipt } = await import('./operator-host.ts')
            return await operatorReceipt(
              await this.#stored(),
              await request.json(),
            )
          }
          let { operatorReply } = await import('./operator-host.ts')
          return await operatorReply(
            await this.#stored(),
            space,
            url.pathname,
            await request.json(),
            () => this.#arming,
            request.headers.get('x-yak-person'),
          )
        }
        return await this.#operate(request)
      } catch (e) {
        if (stopped(e)) throw e
        return no(
          refusing(e, { request: 'operator' }),
          e instanceof Error ? e.message : String(e),
        )
      }
    }
    return no(404, 'no route')
  }

  // The directory batches concurrent reads, and a later check sees a seat
  // removed before it was asked.
  #seat(eid: string, person: string, administrative: boolean) {
    return dirPart.directoryOf(this.#env.STORE).seat(
      eid,
      person,
      administrative,
    )
  }

  // The level `person`'s seat in the space `eid` gives them now, an
  // administrator's read as an owner's, as `#operate` reads it: null for none.
  async #level(
    eid: string,
    person: string,
    administrative: boolean,
  ): Promise<Level | null> {
    let access = await this.#seat(eid, person, administrative)
    if (!access.space) return null
    return access.administrative ? 'owner' : access.role ?? null
  }

  // Whether the person a socket was opened for still writes in its space: a
  // socket outlives the seat it was opened with, so each of the Operator's
  // stands by the seat as it is now.
  async #writes(
    held: { person: string; space: string; administrative?: boolean },
  ) {
    return writes(
      await this.#level(held.space, held.person, !!held.administrative),
    )
  }

  async #operate(request: Request): Promise<Response> {
    let person = request.headers.get('x-yak-person')
    let spaceId = request.headers.get(SPACE)
    if (!person || !spaceId) return no(401, NOBODY)
    let reading = this.#stored()
    reading.catch(() => {})
    // The space and the person's seat in it, as the kernel read them; read
    // here, in one read, for a caller that read none. Read here for every
    // request, it was a round trip on each chat page, asked only once a new
    // incarnation had made its Operator: a runtime sends a request when the
    // code before it yields (T-149700).
    let access = seatOf(request.headers) ?? await this.#seat(
      spaceId,
      person,
      request.headers.get('x-yak-administrative') == '1',
    )
    let space = access.space
    if (!space) return no(404, 'that space is gone')
    let role = access.administrative ? 'owner' as const : access.role ?? null
    if (!writes(role)) return no(403, NOT_A_WRITER)
    if (new URL(request.url).pathname == '/operator/browser') {
      return this.#accept({
        browser: true,
        person,
        space: spaceId,
        administrative: access.administrative,
      }, request)
    }
    let read = await reading
    if (API.test(new URL(request.url).pathname)) {
      let asker = { person, space: spaceId }
      return await read.door.answer(
        request,
        asker,
        access.administrative,
        role,
      )
    }
    if (new URL(request.url).pathname == '/operator/settings') {
      let { setting } = await import('./operator-persona.ts')
      let { set } = await request.json() as { set?: Settings }
      let dir = directory({
        fetch: (req: Request) => dirPart.fetch(req, this.#env),
      })
      return Response.json(
        await setting(
          read.store.g,
          space,
          person,
          set,
          (entities) => dir.apply({ entities }),
        ),
      )
    }
    if (new URL(request.url).pathname == '/operator/carried') {
      let { carrying } = await import('./operator-carried.ts')
      return carrying(
        this.#env,
        await this.#work(),
        space,
        JSON.parse(request.headers.get('x-yak-call') ?? '{}'),
        () => this.#arming,
      )
    }
    let args = await request.json() as Record<string, unknown>
    let { operatorRequest } = await import('./operator-host.ts')
    let held = {
      person,
      role,
      space: spaceId,
      administrative: access.administrative,
      called: space.operator,
    }
    let response = await operatorRequest(
      read,
      held,
      new URL(request.url).pathname,
      args,
      () => this.#arming,
    )
    if (response) return response
    // Its steps run on the pool, as every other Operator session's do: words
    // given while it works land in it.
    let operator = await this.#work()
    if (new URL(request.url).pathname == '/operator/contact') {
      return Response.json(
        await operator.confirmContact(
          held,
          String(args.id ?? ''),
          String(args.number ?? ''),
          args.agreed === true,
          String(args.code ?? ''),
        ),
      )
    }
    // Approve or Decline pressed on an approval's card in the person's
    // conversation (operator-approvals.ts `approvalCard`): theirs alone.
    if (new URL(request.url).pathname == '/operator/approve') {
      let standing = await operator.approve(
        String(args.approval ?? ''),
        String(args.digest ?? ''),
        {
          press: args.act == 'approve',
          decline: args.act == 'decline',
          who: held.person,
          own: true,
        },
      )
      await this.#arming
      return Response.json(standing)
    }
    if (new URL(request.url).pathname == '/operator/receive') {
      let { heardAt } = await import('./operator-channels.ts')
      return await heardAt(operator, this.#env, held, space, args)
    }
    // A conversation begun from a home-page demo (identity.ts `begun`).
    if (new URL(request.url).pathname == '/operator/stepped') {
      let begun = await operator.begunWith(
        held,
        space,
        (args.lines ?? []) as Bundle[],
      )
      return Response.json({ begun })
    }
    if (new URL(request.url).pathname == '/operator/helper') {
      let { spawnHelper } = await import('./operator-helpers.ts')
      return Response.json(await spawnHelper(operator, held, space, args))
    }
    if (new URL(request.url).pathname == '/operator/talk') {
      let { converse } = await import('./operator-conversations.ts')
      return Response.json(
        await converse(
          operator,
          held,
          space,
          String(args.tool),
          args.args as Record<string, unknown>,
        ),
      )
    }
    // A chat's words are worked by the store's own alarm, which they arm,
    // and its answer read once it ends or the wait does.
    let { chat, settled } = await import('./operator-conversations.ts')
    return Response.json(
      await chat(
        operator,
        held,
        space,
        args,
        (s) => settled(operator.store.g, s),
      ),
    )
  }

  // The Operator's store, what to call a person, and what the pages watching
  // it are told: all a read needs, made without the Operator, whose code
  // (its model, its tools, its harness) is loaded and made for what it runs
  // (`#work`). A chat page's first visit made both before its answer.
  #stored() {
    return this.#store ??= unstopped(
      () => this.#store = undefined,
      async () => {
        let starting = Date.now()
        let [{ operatorStore, owing }, { SLICE }, { operatorFrames }] =
          await elapsed('operator_modules_wait', () =>
            Promise.all([
              import('./operator-store.ts'),
              import('@yaks/durable-object/alarm'),
              import('./operator-host.ts'),
            ]))
        let drive = () => {
          if (!this.#draining && Date.now() >= this.#until) {
            this.#until = Date.now() + SLICE
          }
          if (Date.now() >= this.#until) return
          let until = this.#until
          this.#ctx.waitUntil?.(
            this.#work().then(() =>
              store.fx.work(store.g, undefined, { until })
            )
              .catch((e) => caught(e, { request: 'operator effects' })),
          )
        }
        // A running Operator takes new words beside its step. When a cold
        // write starts the Operator, the caller wakes it after receiving the
        // receipt. Keep a durable alarm in case that caller disappears.
        let nudge = () => {
          if (!this.#operator && this.#asked) {
            this.#arming = this.clock.arm(Date.now() + SLICE)
            this.#owed = drive
          } else {
            this.#arming = this.clock.arm(Date.now())
            drive()
          }
        }
        let post = once(async () => {
          let { operatorPost } = await import('./metered.ts')
          return operatorPost(this.#env, async (letter) => {
            let { owes } = await import('./operator-channels.ts')
            return await owes(store, letter)
          })
        })
        let chat = once(async () =>
          (await import('./chat.ts')).chatters(this.#env, 'operator')
        )
        let store: OperatorStore = await elapsed(
          'operator_open_wait',
          () =>
            operatorStore(
              this.#ctx.storage,
              {
                version: this.#env.CF_VERSION_METADATA?.id,
                report: (e, where) =>
                  caught(e, {
                    request: 'operator effects',
                    handler: where.handler,
                  }),
                nudge,
              },
              {
                senders: {
                  operator: { send: async (m) => (await post()).send(m) },
                },
                chatter: async (via) => (await chat())[via],
              },
              operatorVectors(this.#env, {
                space: () => store,
                arm: (at) => this.clock.arm(at),
                hold: (work) => this.#ctx.waitUntil?.(work),
                ready: () => store.vectors?.run(),
              }),
            ),
        )
        // The logos of integrations its lines and approvals name, as the
        // platform keeps them (connections.ts `logosOf`).
        store.logos = async (named) => {
          let { ctxOf, logosOf } = await import('./connections.ts')
          return logosOf(ctxOf(this.#env).graph.read, this.#env, named)
        }
        owing(store.fx, () => this.#work())
        // A commit here stirs the subscriptions over this store, one stir at
        // a time: one under way already looks after the commit.
        let stirring = false
        store.g.use(ownCommits(() => {
          if (stirring) return
          stirring = true
          this.#ctx.waitUntil?.(
            import('./operator-schedules.ts')
              .then(({ heard }) => heard(store, true))
              .then((at) => at == null ? undefined : this.clock.arm(at))
              .catch((e) => caught(e, { request: 'operator subscriptions' }))
              .finally(() => stirring = false),
          )
        }))
        // What a person is called, as the Operator asks it (operator.ts
        // `named`).
        let named = (person: string) =>
          dirPart.directoryOf(this.#env.STORE).nameAt(person)
        let { operatorApi } = await import('./operator-api.ts')
        let { spaceOf } = await import('./operator-root.ts')
        // Its conversations as their pages watch them, drawn with the
        // Operator's name and where a conversation opens.
        let opens = async () => {
          let eid = this.ctx.id?.name ?? await spaceOf(store)
          let space = eid
            ? await dirPart.directoryOf(this.#env.STORE).at(eid)
            : null
          return space
            ? {
              called: space.operator,
              opens: managePath('operator', space.slug),
            }
            : {}
        }
        this.#frames = operatorFrames(store, named, opens)
        // Its pages' reads and writes through @yaks/api, whose sockets the
        // runtime kept while the object was away are watching again.
        let door = operatorApi(store, this.#ctx, {
          talks: this.#frames.talks,
          clock: this.#env.CLOCK,
          hold: (work) => this.#ctx.waitUntil?.(work),
          arm: this.clock.arm,
          // A page's socket stands by its person's seat in the space as it is
          // now, an administrator's read as an owner's, as `#operate` reads it.
          seat: async (person, administrative) => {
            let space = await spaceOf(store)
            return space ? this.#level(space, person, administrative) : null
          },
          report: (e) => caught(e, { request: 'operator socket' }),
        })
        let woke = door.wake()
        if (woke) woke.catch((e) => caught(e, { request: 'operator socket' }))
        // An incarnation takes up what the one before it left: a step a deploy
        // reset under its reply runs again at once, on the wake its first
        // request's caller sends once it has the answer (a page reconnecting,
        // build-door.ts `builderOf`), rather than whenever the person next says
        // something. Worked, not only armed: an alarm the reset cut off can hold
        // the next one back for minutes.
        this.#owed = () => {
          this.#arming = this.clock.arm(Date.now())
          drive()
        }
        hop('operator_boot_wait', Date.now() - starting)
        return {
          store,
          named,
          door,
        }
      },
    )
  }

  async #work() {
    await keyed(this.#env)
    return this.#operator ??= unstopped(
      () => this.#operator = undefined,
      async () => {
        let { store } = await this.#stored()
        let frames = this.#frames!
        let { attachmentTools, handleChannels } = await import(
          './operator-channels.ts'
        )
        let { operating } = await import('./operator.ts')
        let operator = operating(store, this.#env, {
          tools: attachmentTools(this.#env),
          browsers: this.#lent,
          tell: (session) => {
            void frames.tell(session).catch((e) =>
              caught(e, { request: 'operator socket' })
            )
            void import('./operator-calls.ts').then(({ moved }) =>
              moved(store, session)
            ).catch((e) => caught(e, { request: 'operator call' }))
          },
          typing: (session, text) => {
            void frames.typing(session, text).catch((e) =>
              caught(e, { request: 'operator socket' })
            )
            void import('./operator-calls.ts').then(({ typed }) =>
              typed(store, session, text)
            ).catch((e) => caught(e, { request: 'operator call' }))
          },
          stepped: (session) =>
            void import('./operator-calls.ts').then(({ stepped }) =>
              stepped(store, session)
            ).catch((e) => caught(e, { request: 'operator call' })),
        })
        handleChannels(operator, this.#env)
        return operator
      },
    )
  }

  // The incarnation's owed work, started once, where nobody waits on an
  // answer: the runtime sends one on in turns of the object's event loop, and
  // the Operator's start-up run as the answer was read, or on a timer as the
  // handler returned, held a first visit to /manage/checks 81-140 ms
  // (T-149700).
  #resume() {
    let owed = this.#owed
    this.#owed = undefined
    try {
      owed?.()
    } catch (e) {
      caught(e, { request: 'operator resume' })
    }
  }

  override async alarm(): Promise<void> {
    if (this.ceiling.stopped(true)) return await super.alarm()
    await keyed(this.#env)
    let revivals = this.#revivals
    let space: dirPart.Space | null
    try {
      let eid = this.ctx.id?.name
      if (!eid) {
        // An older alarm can arrive without the object's name.
        let { spaceOf } = await import('./operator-root.ts')
        eid = await spaceOf((await this.#stored()).store)
      }
      space = eid ? await dirPart.directoryOf(this.#env.STORE).at(eid) : null
    } catch (error) {
      caught(error, { request: 'operator alarm admission' })
      let wait = stopped(error) ? error.retry.after : RETRY
      await this.clock.arm(Date.now() + wait)
      return
    }
    if (space && !space.trashed) return await super.alarm()
    // Leave a restore's alarm in place if it overtook the directory read.
    if (revivals == this.#revivals) await this.#ctx.storage.deleteAlarm?.()
  }

  // What the package's object opens: the Operator, and what its alarm works
  // (@yaks/durable-object `clock`). The alarm answers once its slice is
  // under way, held by the object (`waitUntil`): one still open when its
  // object is reset holds back every alarm after it until Cloudflare gives
  // up on it, fourteen minutes for Jeff's (T-145428). A stopped object's
  // alarm comes back when its window ends.
  protected override specify = (): Spec => ({
    open: async () => {
      let operator = await this.#work()
      let { store } = operator
      let waiting = () => Date.now() + (store.waiting?.() ?? 0)
      let backfill = async (more: Promise<boolean>) =>
        await more ? waiting() : null
      return {
        serve: (request) => this.fetch(request),
        works: {
          // The alarm drains owed work in this slice. A wake's extra arm is
          // for the caller that starts work outside an alarm.
          owed: () => {
            this.#owed = undefined
            return null
          },
          sockets: async () => (await this.#stored()).door.renew(),
          contacts: async () => {
            let { contactBackfill } = await import('./contact-move.ts')
            return backfill(contactBackfill(store, this.#env))
          },
          attachments: async () => {
            let { attachmentBackfill } = await import('./attachment-move.ts')
            return backfill(attachmentBackfill(store, this.#env))
          },
          oracles: async () => {
            let { oracleBackfill } = await import('./oracle-move.ts')
            return backfill(oracleBackfill(store))
          },
          // The projects the oracle pass hid before it knew a project from
          // an oracle (oracle-move.ts).
          projects: async () => {
            let { projectRepair } = await import('./oracle-move.ts')
            return backfill(projectRepair(store))
          },
          owners: async () => {
            let { ownerBackfill } = await import('./owner-move.ts')
            return backfill(ownerBackfill(store))
          },
          // Each person's share of what the Operator spent before spends
          // named a person (spend-move.ts).
          spentPeople: async () => {
            let { spendBackfill } = await import('./spend-move.ts')
            return backfill(spendBackfill(store, this.#env))
          },
          memoryOwners: async () => {
            let { memoryOwnerBackfill } = await import(
              '@yaks/platform/operator-memory'
            )
            return backfill(memoryOwnerBackfill(store))
          },
          // The files a tool made since the attachment pass, attached
          // beside the call that made them (output-move.ts).
          outputs: async () => {
            let { outputBackfill } = await import('./output-move.ts')
            return backfill(outputBackfill(store))
          },
          // How each line's words came, in @yaks/session's `channel`
          // (channel-move.ts).
          channels: async () => {
            let { channelBackfill } = await import('./channel-move.ts')
            return backfill(channelBackfill(store))
          },
          words: async () => {
            let { wordsBackfill } = await import(
              '@yaks/platform/operator-words'
            )
            let { CHANNELED } = await import('./channel-move.ts')
            if (!store.marks?.get(CHANNELED)) return waiting()
            let backup = () =>
              (this.#ctx.storage as Bookmarked).getCurrentBookmark!()
            let place: Promise<dirPart.Space | null> | undefined
            let space = () =>
              place ??= import('./operator-root.ts')
                .then(({ spaceOf }) => spaceOf(store))
                .then((eid) =>
                  eid ? dirPart.directoryOf(this.#env.STORE).at(eid) : null
                )
            let { attached } = await import('./attachments.ts')
            return backfill(wordsBackfill(store, backup, async (sha) => {
              let at = await space()
              let bytes = at && await attached(this.#env, at, sha)
              return bytes ? new TextDecoder().decode(bytes) : undefined
            }))
          },
          // Each line's files found among the attachments, and the words
          // read from them on theirs (files-move.ts).
          files: async () => {
            let { filesBackfill } = await import('./files-move.ts')
            return backfill(filesBackfill(store))
          },
          // An input's item where 1ad52d4f7 wrote it, in @yaks/session's
          // word (files-move.ts).
          intake: async () => {
            let { intakeBackfill } = await import('./files-move.ts')
            return backfill(intakeBackfill(store))
          },
          lines: async () => {
            let { lineBackfill } = await import('./line-move.ts')
            return backfill(lineBackfill(store, this.#env))
          },
          numbers: async () => {
            let { numberBackfill } = await import('./number-move.ts')
            return backfill(numberBackfill(store))
          },
          // A person's wakes and subscriptions in @yaks/wake's words, before
          // `drain` fires any (wake-move.ts).
          wakes: async () => {
            let { wakeBackfill } = await import('./wake-move.ts')
            return backfill(wakeBackfill(store))
          },
          // Each wake set before a steered turn's wakes kept its mark,
          // judged by the turn that set it, before `drain` fires any
          // (heard-wake-move.ts).
          heardWakes: async () => {
            let { heardWakes } = await import('./heard-wake-move.ts')
            let judged = await heardWakes(store)
            if (judged) {
              let { spaceOf } = await import('./operator-root.ts')
              console.info('yak operator heard wakes', {
                space: await spaceOf(store),
                ...judged,
              })
            }
            return null
          },
          // Subscriptions kept before they were live, given up their
          // cadence and read once, so each app they read tells them of its
          // commits from then on (operator-schedules.ts).
          subscriptions: async () => {
            let { uncadenced } = await import('./operator-schedules.ts')
            return backfill(uncadenced(store))
          },
          // Each ask's instructions kept once per text
          // (instructions-move.ts).
          instructions: async () => {
            let { toldBackfill } = await import('./instructions-move.ts')
            return backfill(toldBackfill(store))
          },
          // Recall and decision notes kept before they were turn notes,
          // made turn notes (@yaks/platform/operator-notes).
          notes: async () => {
            let { noteBackfill } = await import('@yaks/platform/operator-notes')
            return backfill(noteBackfill(store))
          },
          // The vectors its recall ranks by meaning, drained behind the
          // object's own work (@yaks/embedding `sleeper`).
          vectors: () => {
            store.vectors?.run()
            return store.vectors?.retry() ?? null
          },
          drain: async (until) => {
            let { drain } = await import('./operator-store.ts')
            this.#draining = true
            try {
              return await drain(
                store,
                this.#until = until,
                operator.watching,
              )
            } finally {
              this.#draining = false
            }
          },
        },
      }
    },
    report: (e, entry) => caught(e, { request: `operator ${entry}` }),
    alarm: {
      keep: this.#ctx.waitUntil && ((work) => this.#ctx.waitUntil!(work)),
    },
  })

  // The 101, and the socket handed to the runtime so it outlives this object:
  // a browser lent to the Operator, which speaks the platform's subprotocol,
  // which the 101 names as a browser requires (identity.ts `PROTOCOL`).
  #accept(held: Socket, request?: Request): Response {
    let pair = new WebSocketPair()
    this.#ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment(held)
    return new Response(
      null,
      {
        status: 101,
        webSocket: pair[0],
        headers: request && protocolled(request)
          ? { 'sec-websocket-protocol': PROTOCOL }
          : {},
      } as ResponseInit & { webSocket: unknown },
    )
  }

  // Where `person` is on this Operator, across their tabs watching a
  // conversation of theirs here (all but `closing`), each a socket of its
  // store that said its tab, kept as their whereabouts (whereabouts.ts).
  async #present(person: string, closing?: Wire) {
    let tabs = this.#ctx.getWebSockets().filter((ws) => ws != closing)
      .flatMap((ws) => {
        let held = ws.deserializeAttachment() as Paged | null
        return paged(held) && held!.tab && held!.read?.person == person
          ? [held!.tab]
          : []
      })
    let { store } = await this.#stored()
    let { spaceOf } = await import('./operator-root.ts')
    let place = this.ctx.id?.name ?? await spaceOf(store)
    if (!place) return
    let { present } = await import('./whereabouts.ts')
    await present(this.#env, {
      person,
      channel: 'operator',
      place,
      state: tabsState(tabs),
    })
  }

  /** A frame from a page reading the Operator's store, or from a browser
   * lent to it. A page saying where its tab is (`{tab}`) says where its
   * person is. */
  override webSocketMessage(ws: Wire, data: string | ArrayBuffer): void {
    let held = ws.deserializeAttachment() as Socket | Paged | null
    // A page reading the Operator's store through @yaks/api.
    if (paged(held)) {
      let tab = tabOf(data)
      let person = (held as Paged).read?.person
      if (tab && person) {
        ws.serializeAttachment({ ...held, tab })
        return void this.#present(person).catch((e) =>
          caught(e, { request: 'operator whereabouts' })
        )
      }
      return void this.#stored().then(({ door }) => door.message(ws, data))
        .catch((e) => caught(e, { request: 'operator socket' }))
    }
    // A lent browser answers the calls asked of it (operator-browser.ts).
    if (held && 'browser' in held) {
      this.#lent.heard(held, data).catch((e) =>
        caught(e, { request: 'operator browser' })
      )
    }
  }

  /** A socket closed. A lent browser's calls fail at once, rather than
   * waiting out the person. */
  override webSocketClose(ws: Wire): void {
    let held = ws.deserializeAttachment() as Socket | Paged | null
    if (paged(held)) {
      let { tab, read } = held as Paged
      if (tab && read?.person) {
        void this.#present(read.person, ws).catch((e) =>
          caught(e, { request: 'operator whereabouts' })
        )
      }
      return void this.#stored().then(({ door }) => door.close(ws))
        .catch((e) => caught(e, { request: 'operator socket' }))
    }
    if (held && 'browser' in held) this.#lent.gone(ws)
  }
}

// What `make` makes, held by the caller, unless the object was stopped
// (@yaks/durable-object `Stopped`) making it: then `forget` drops it, so the
// first call after the window makes it again. Any other failure stands.
let unstopped = <T>(forget: () => void, make: () => Promise<T>): Promise<T> => {
  let made = make()
  made.catch((e) => stopped(e) && forget())
  return made
}

// The doors of the Operator's store's @yaks/api (operator-api.ts), outside
// `/operator/`: an object on code from before them reads none of them as an
// Operator request it would run.
let API = /^\/api\/(apply|query|ws|waiting\/ws)$/

// What the work under way when its space was deleted fails with: a reset's
// words (@yaks/durable-object `moved`), so the instance reports none of it
// and a caller sends it again, as for any other reset.
let WIPED = 'Durable Object reset because its space was deleted'

let no = (status: number, message: string) =>
  Response.json({ error: 'Refused', message }, { status })

// The runtime's socket factory, declared structurally so this file needs no
// Cloudflare dependency to compile (the same declaration @yaks/durable-object
// makes for the same reason).
declare let WebSocketPair: { new (): { 0: unknown; 1: Wire } }
