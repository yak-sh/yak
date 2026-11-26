// The Operator's store as its page reads and writes it: @yaks/api's `/apply`,
// `/query` and `/ws`, each request as the person the kernel vouched for. Many
// people share a space's store, so each reads only what is theirs or nobody's
// (operator-access.ts `sight`), on the socket too, a reply's text as it is
// written included (@yaks/api's transient frames go to a subscription's
// members alone), and writes only what is theirs to write (`mayWrite`).
//
// The object the store stands in (build.ts) hands this its `/api/*` requests
// from people who write in the space, and only theirs, and the sockets it
// accepted; its other sockets (a build's page, a lent browser) are not this
// door's. A person's chat page watches its conversation here too
// (@yaks/platform/operator-talk), answered by the Operator's frames
// (operator-host.ts `operatorFrames`).
// A socket outlives the seat it was opened with, so it stands by its person's
// seat as it holds it: the level the handshake read, checked on every frame in
// and every delivery out. It is read again when the directory says a seat in
// the space moved (`reseat`), once more after a socket accepted just after
// one moved, and on a frame or delivery once the held read is older than
// FRESH, so a notice that was lost costs that long. Once they no longer write
// in the space it hears nothing more, and closes.
import { api, type Handler, subscriptions } from '@yaks/api'
import { beside, computed, type Reached } from '@yaks/api/reached'
import { type Hibernation, socketRenewals, sockets } from '@yaks/durable-object'
import { after, type Clock, system } from '@yaks/fp'
import { type Level, writes } from '@yaks/member'
import { UPDATE_WAITING, waitingBundle } from '@yaks/platform/update-waiting'
import { cardsSpace, updateRows } from '@yaks/platform/update-rows'
import { draftRows, draftsSpace } from '@yaks/platform/operator-drafts'
import { settingsRow, settingsSpace } from '@yaks/platform/operator-settings'
import { talkAsked } from '@yaks/platform/operator-talk'
import {
  type Matches,
  matchesAsked,
  matchesRow,
} from '@yaks/platform/operator-matches'
import { trialDoc } from '@yaks/trial/vocab'
import { line } from '@yaks/query'
import type { Bundle, Graph, ReadOpts } from '@yaks/graph'
import { mayWrite, sight } from './operator-access.ts'
import { spaceOf } from './operator-root.ts'
import type { OperatorStore } from './operator-store.ts'
import { paged } from './build-door.ts'
import { updatesOf, waitingUntil } from './operator-updates.ts'

/** How long a socket's held seat stands unread: older, it is read again on
 * the socket's next frame or delivery, so a person whose seat was taken away
 * and whose notice (`reseat`) was lost stops hearing within this. */
export let FRESH = 30_000

/** How long a held seat stands that the directory could not confirm: a read
 * that fails keeps the hold and is tried again a FRESH later, and once the
 * seat was last read longer ago than this, the socket closes. */
export let LAPSE = 10 * 60_000

/** A socket's read as it holds its seat: `seated` is when `level` was read
 * (the clock's milliseconds). */
type Seated = ReadOpts & { seated?: number }

/** Who a request is from, as the kernel said: a person who writes in a
 * space (build.ts `#operate`). */
export type Asker = { person: string; space: string }

/** What the door asks of the object it stands in. */
export type Seating = {
  /** `person`'s seat in the space as the directory has it now, an
   * administrator's (`administrative`, as the kernel vouched at the
   * handshake) read as theirs: the level it gives, or null for none. Read
   * when a seat moved (`reseat`), when a held one is older than FRESH, and
   * for a socket that holds no level. */
  seat: (person: string, administrative: boolean) => Promise<Level | null>
  report?: (error: Error) => void
  clock?: Clock
  hold?: (work: Promise<void>) => void
  /** The object's alarm, shared with its other work. */
  arm?: (at: number) => Promise<void>
  /** the person's conversations, as their chat pages watch them
   * (operator-host.ts `operatorFrames`); none are answered without */
  talks?: Reached
}

let inputs = [
  '$delete',
  'notification',
  'decision',
  'filed',
  'subscription',
  'opened',
  'archived',
  'decided',
  'completed',
  'cancelled',
  'blocked',
  'failed',
  'resolved',
  'regressed',
  'broken',
  'task',
  'requires',
  'edge',
  'notified',
  'doc',
  'occurrence',
  'operator_request',
  'operator_approval',
]

// `rows`, the first saying when the answer next moves without a write
// (`at`, Infinity for never).
let expiring = (rows: Bundle[], at: number): Bundle[] =>
  rows.length && Number.isFinite(at)
    ? [{ ...rows[0], $expires: { at } }, ...rows.slice(1)]
    : rows

/** Whether the person's live read answers `line`: their Updates count, or
 * their Updates cards in the space. */
let personal = (asked: string) =>
  asked == UPDATE_WAITING || cardsSpace(asked) != undefined

/** @yaks/api over `store`, its sockets among the object's (`ctx`). */
export let operatorApi = (
  store: OperatorStore,
  ctx: Hibernation,
  { seat, report, clock = system, hold, arm, talks }: Seating,
) => {
  let subs = subscriptions(store.g)
  let renewals = arm && socketRenewals(arm, { now: clock.now, keep: hold })
  let waiting = computed(store.g, {
    affects: (bundles) => bundles.some((b) => inputs.some((key) => key in b)),
    hold,
    clock,
    read: async (line, read) => {
      let person = read?.person, space = await spaceOf(store)
      if (!person || !space) return []
      let asked = cardsSpace(line)
      if (asked != undefined) {
        if (asked != space) return []
        let { updates, expires } = await updatesOf(
          store,
          person,
          space,
          50,
          false,
          clock.now(),
        )
        return expiring(updateRows(person, space, updates), expires)
      }
      let { count, expires } = await waitingUntil(
        store,
        person,
        space,
        clock.now(),
      )
      return expiring(
        [waitingBundle(person, { space, slug: '', count })],
        expires,
      )
    },
    renew: (answer) =>
      Array.isArray(answer)
        ? (answer[0]?.$expires as { at: number } | undefined)?.at
        : undefined,
    renewAt: renewals?.at,
    tags: { request: 'Operator Updates' },
  })
  // The person's drafts, as their page graph holds them
  // (@yaks/platform/operator-drafts): read again only when a draft moves.
  let drafts = computed(store.g, {
    affects: (bundles) => bundles.some((b) => 'draft' in b || '$delete' in b),
    hold,
    clock,
    read: async (asked, read) => {
      let person = read?.person, space = await spaceOf(store)
      if (!person || !space || draftsSpace(asked) != space) return []
      return draftRows(space, await store.g.read(line`.draft.by=${person}&*`))
    },
    tags: { request: 'Operator drafts' },
  })
  // The Operator's name and voice, off its persona, as its settings page
  // draws them (@yaks/platform/operator-settings): read again when a write
  // may have moved the persona, by the page or by the Operator itself.
  let settings = computed(store.g, {
    affects: (bundles) =>
      bundles.some((b) => 'doc' in b || 'speech' in b || 'persona' in b),
    hold,
    clock,
    read: async (asked, read) => {
      let space = await spaceOf(store)
      if (!read?.person || !space || settingsSpace(asked) != space) return []
      let { settingsIn } = await import('./operator-persona.ts')
      return [settingsRow(space, await settingsIn(store.g.storage, space))]
    },
    tags: { request: 'Operator settings' },
  })
  // The rounds a person picks in, or one round as they tap through it, as
  // the Matches page draws them (@yaks/platform/operator-matches): read again
  // when a trial's rows move, a pick in the chat or the page among them.
  let trials = ['$delete', ...Object.keys(trialDoc.$defs ?? {})]
  let matches = computed(store.g, {
    affects: (bundles) => bundles.some((b) => trials.some((key) => key in b)),
    hold,
    clock,
    read: async (asked, read) => {
      let person = read?.person, space = await spaceOf(store)
      let page = matchesAsked(asked)
      if (!person || !space || page?.space != space) return []
      let { matching } = await import('./operator-trials.ts')
      let got = await matching(
        store,
        person,
        page.round ? { round: page.round } : {},
      )
      return [matchesRow(space, page.round, got as Matches)]
    },
    tags: { request: 'Operator matches' },
  })
  // Whether each person holds a seat, as the directory last said for their
  // socket: what it is read with.
  let members = new Map<string, boolean>()
  // The level of a socket that holds none (one accepted before sockets held
  // theirs), read once for the incarnation, until a seat moves.
  let unheld = new Map<string, Promise<Level | null>>()
  let key = (person: string, administrative: boolean) =>
    `${person} ${administrative}`
  // When the space's seats last moved, as the directory said.
  let moved = -Infinity
  // Each person's seat as it is being read for their sockets, and when a
  // read of it last failed.
  let confirming = new Map<string, Promise<Level | null>>()
  let missed = new Map<string, number>()
  // `person`'s seat read again, and each of their sockets holding what it
  // gives, as read now. A read under way is shared unless `again` (a seat
  // moved since it began), and only the last one begun is held.
  let confirm = (person: string, admin: boolean, again = false) => {
    let at = key(person, admin)
    let under = confirming.get(at)
    if (under && !again) return under
    let seated = clock.now()
    let reading: Promise<Level | null> = seat(person, admin).then(
      async (level) => {
        if (confirming.get(at) !== reading) return level
        missed.delete(at)
        await live.restand((read) =>
          read?.person == person && !!read.administrative == admin
            ? { ...read, level, seated } as Seated
            : read
        )
        return level
      },
      (e) => {
        missed.set(at, clock.now())
        if (!again) report?.(e)
        throw e
      },
    ).finally(() => {
      if (confirming.get(at) === reading) confirming.delete(at)
    })
    confirming.set(at, reading)
    return reading
  }
  let levelOf = (read: ReadOpts) => {
    let person = String(read.person), admin = !!read.administrative
    if ('level' in read) {
      // A read held before holds were dated (`seated`) is read again, and
      // never lapses.
      let level = read.level as Level | null, now = clock.now()
      let { seated } = read as Seated
      if (seated != undefined && now - seated < FRESH) return level
      let held = seated != undefined && now - seated > LAPSE ? null : level
      if (now - (missed.get(key(person, admin)) ?? -Infinity) < FRESH) {
        return held
      }
      return confirm(person, admin).catch(() => held)
    }
    let known = unheld.get(key(person, admin))
    if (!known) {
      known = seat(person, admin)
      known.catch(() => unheld.delete(key(person, admin)))
      unheld.set(key(person, admin), known)
    }
    return known
  }
  let theirs = beside(
    beside(
      beside(
        beside(subs, waiting, personal),
        drafts,
        (asked) => draftsSpace(asked) != undefined,
      ),
      settings,
      (asked) => settingsSpace(asked) != undefined,
    ),
    matches,
    (asked) => matchesAsked(asked) != undefined,
  )
  let live = sockets(
    // Its chat pages' conversations, each socket carrying where its tab is
    // (build.ts).
    talks
      ? beside(theirs, talks, (asked) => talkAsked(asked) != undefined)
      : theirs,
    {
      acceptWebSocket: (ws) => ctx.acceptWebSocket(ws),
      getWebSockets: () =>
        ctx.getWebSockets().filter((ws) => paged(ws.deserializeAttachment())),
      storage: ctx.storage,
    },
    report,
    {
      renewals,
      // A socket keeps who opened it, and is read with their sight as their
      // seat stands.
      read: (read) => {
        let person = String(read?.person)
        let member = members.get(person) ?? false
        return { person, ...sight(store, { person, member }) }
      },
      authorize: (_read, _writer, held) => {
        let person = held?.person
        if (!held || !person) return false
        return after(levelOf(held), (level) => {
          members.set(person, level != null)
          return writes(level)
        })
      },
    },
  )
  // The store as `who` writes it: what is theirs, or nothing in the batch.
  let writing = (who: Asker): Graph => ({
    ...store.g,
    apply: async (bundles, opts) => {
      await mayWrite(store, who, bundles)
      return store.g.apply(bundles, opts)
    },
  })
  let as = (who: Asker): Handler =>
    api({
      graph: writing(who),
      subs,
      authenticate: () => ({ by: who.person }),
      read: () => sight(store, { person: who.person, member: true }),
    })
  return {
    /** `/api/apply`, `/api/query` or `/api/ws`, asked by `who`. */
    answer: (
      request: Request,
      who: Asker,
      administrative = false,
      level?: Level | null,
    ): Response | Promise<Response> => {
      let url = new URL(request.url)
      url.pathname = url.pathname.slice('/api'.length)
      let read = { person: who.person, administrative }
      if (url.pathname != '/ws' && url.pathname != '/waiting/ws') {
        return as(who)(new Request(url, request))
      }
      if (level === undefined) return live.accept(request, read)
      let held: Seated = { ...read, level, seated: clock.now() }
      return after(live.accept(request, held), (ok) => {
        // The kernel read this seat before the socket reached here, so a
        // notice that came in the meantime found no socket of theirs.
        if (clock.now() - moved < FRESH) {
          let again = confirm(who.person, administrative)
          hold?.(again.then(() => {}, () => {}))
        }
        return ok
      })
    },
    /** A seat in the space moved (build.ts `SEATED`): each person with a
     * socket here has their seat read again, once, and their sockets hold
     * what it gives now; one who no longer writes is closed. A seat that
     * could not be read is left as it was, read again after FRESH, and the
     * failure thrown, so the directory tells again. */
    reseat: async () => {
      moved = clock.now()
      unheld.clear()
      let held = new Map<string, [string, boolean]>()
      for (let ws of ctx.getWebSockets()) {
        let read = (ws.deserializeAttachment() as { read?: ReadOpts } | null)
          ?.read
        if (read?.person) {
          let admin = !!read.administrative
          held.set(key(read.person, admin), [read.person, admin])
        }
      }
      let read = await Promise.allSettled(
        [...held.values()].map(([person, admin]) =>
          confirm(person, admin, true)
        ),
      )
      let failed = read.find((r) => r.status == 'rejected')
      if (failed) throw failed.reason
    },
    /** A frame from one of its sockets: the object's `webSocketMessage`. */
    message: live.message,
    /** One of its sockets closed: the object's `webSocketClose`. */
    close: live.close,
    /** Its sockets' subscriptions opened again, as the object wakes. */
    wake: live.wake,
    renew: live.renew,
  }
}
