// The builder's own object (T-34240): one Durable Object per SPACE, holding
// the conversation and running builder.ts's `build()` one at a time, with the
// page listening on a WebSocket. The loop is the last ticket's (T-34239); what
// is here is the place it happens and the wire it happens on.
//
// Why an object at all. A build is a minute of tool calls, and the person is
// watching it: the words, each tool as it starts and as it answers, the
// address at the end. A Worker isolate cannot be that — the request that
// starts the build is not the one holding the socket, and there is no second
// place both can reach. One object per space is: every page of that space
// arrives at it, its memory is the conversation, and its single thread is what
// makes "one build at a time here" a fact rather than a lock.
//
// A plain object, not the agents SDK. `agents` (the Agent class, hibernatable
// sockets, state sync) is the obvious fit and was tried first; four things
// sent it back, each checked against agents@0.22.0 rather than the docs:
//
//   1. its peers are pins of its own — `zod ^4`, `@modelcontextprotocol/sdk
//      1.30.0` exactly — so it installs only with --legacy-peer-deps;
//   2. `AIChatAgent`, the half that holds a transcript, has left the package
//      (`agents/ai-chat-agent` throws at import) for `@cloudflare/ai-chat`,
//      whose own peers are `ai ^6||^7` and `@ai-sdk/react`;
//   3. its client is `agents/client` / `agents/react`, npm modules over the
//      AI SDK's UI-message stream — and our pages are hand-written ESM with
//      no build step, so the page could not import them and would be writing
//      those frames by hand anyway (T-34242);
//   4. `Agent extends DurableObject` from `cloudflare:workers`, which nothing
//      outside workerd can construct: every test here would become a
//      `wrangler dev` boot, where the object below runs in the same in-memory
//      stand-in the Store does (testing.ts) at a millisecond apiece.
//
// What it would have replaced is the forty lines under `#accept` and
// `#frames`. The SDK is the right answer the day our pages take a build step —
// its React chat client is the payoff — and none of that is true today.
//
// The transcript lives here, in the object's own SQLite, and not as entities
// in the space's home store: the builder's whole reason to exist is a person
// who has no app yet, so there is no app store to write to, and a conversation
// that shipped nothing is not somebody's data to keep, quota and bill. What a
// build produces — the app, its files, the deploy — is already in the graph,
// written by the tools as the person. Living outside the graph, it also dies
// outside it: closing a space calls `wiped` below, because no tombstone in the
// directory reaches an object keyed by eid (T-34371).
//
// The wire is one JSON frame per event, and the key names the frame:
//
//   page → object   {say}                        a person's line
//   object → page   {said, text}                 a line of the conversation
//                   {tool, call, line}           a tool, starting
//                   {ran, call, line, ok}        that tool, answered
//                   {built}                      the app's address
//                   {done, text, refused?}       the turn's last sentence
//                   {ready, building}            the replay is over
//                   {busy}                       a build is already running
//
// A page that reconnects hears the whole conversation again as those same
// frames, in order, then `{ready}` — so a reload costs nothing and the page
// has one renderer for a live build and a replayed one.
//
// And the same frames with no socket at all. A browser that ran no script
// posts one line to `/api/build` and is answered a page (pages.ts `building`,
// T-34242); what that page draws is `POST /say` below — the round waited for,
// then the whole conversation as this same list. One wire, two ways to read
// it.
import {
  driver,
  type DurableStorage,
  type Hibernation,
  type Wire,
} from '@yaks/durable-object'
import type { Alarms } from './operator-store.ts'
import { level, writes } from '@yaks/member'
import {
  col,
  type CreateTable,
  type Driver,
  select,
  table,
  val,
} from '@yaks/sql'
import type { Beat, Line } from './builder.ts'
import { directory, type Space } from './directory.ts'
import { behind, type Restartable } from './running.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { caught, refusing } from './defects.ts'
import { type Browsers, browsers, type Lent } from './operator-browser.ts'
import { PROTOCOL, protocolled } from './protocol.ts'
import { managePath } from './route.ts'
import {
  type Frame,
  type Held,
  NOBODY,
  NOT_A_WRITER,
  SPACE,
  WAIT,
} from './build-door.ts'

export {
  BUILD,
  builderOf,
  type Frame,
  type Held,
  joining,
  NOBODY,
  NOT_A_WRITER,
  posting,
  SPACE,
  WAIT,
  wiped,
} from './build-door.ts'

/**
 * The slice of a `DurableObjectState` this object needs: its SQLite, and its
 * hibernatable sockets. A Worker's own `DurableObjectState` satisfies it —
 * both halves are @yaks/durable-object's own types, and its `conform.ts` is
 * where they are held to the runtime's.
 *
 * This class is NOT in workers/yak/conform.ts beside the Store, and cannot be:
 * it runs `build()`, so the whole kernel is in its module graph, and that gate
 * is checked with no Deno anywhere in scope (door.ts). What is Cloudflare's
 * here is the socket slice above, which is checked where it is declared.
 */
export type State = Hibernation & Restartable & {
  storage: DurableStorage & Restartable['storage'] & {
    // The one way to empty an object: dropping the tables leaves metadata
    // behind, and an object whose storage is empty ceases to exist. It is what
    // a deleted space's conversation goes through ({@link Builder.wipe}), the
    // same call the Store makes for the same reason (graph.ts).
    deleteAll(): Promise<void>
  } & Alarms
}

// Who is at a socket, and whether the page is watching the Operator rather
// than a build, or is a browser lent to the Operator (operator-browser.ts).
type Watching = Held & { operator?: boolean }
type Socket = Watching | Lent

// One line about a tool, for somebody watching rather than reading: the first
// line of it, and not much of that. A tool answers a paragraph; a page draws a
// row.
let CUT = 120
export let line = (text: string): string => {
  let first = text.trim().split('\n')[0] ?? ''
  return first.length > CUT ? `${first.slice(0, CUT - 1)}…` : first
}

// The address in a tool's answer, if it named one. `app_deploy` answers with
// the app's own URL, which is the one thing a person wants at the end.
let AT = /https:\/\/[^\s)"']+/
export let addressed = (text: string): string | null =>
  AT.exec(text)?.[0] ?? null

/**
 * The conversation as the page hears it. One stored {@link Line} becomes the
 * frames it would have arrived as — a builder's words, then each tool it asked
 * for — so a replay and a live build are the same sequence and the page has
 * one way to draw both.
 *
 * A tool line carries the answer, so `ran` is what a replay can say; the
 * `tool` frame that opened it is said again from the call the builder line
 * kept, which is what keeps the pairs in order.
 */
export let frames = (said: Line[]): Frame[] => {
  let out: Frame[] = []
  for (let l of said) {
    if (l.said == 'person') out.push({ said: 'person', text: l.text })
    else if (l.said == 'builder') {
      if (l.text) out.push({ said: 'builder', text: l.text })
      for (let c of l.calls ?? []) {
        out.push({ tool: c.name, call: c.id, line: line(c.args) })
      }
    } else {
      out.push({ ran: l.name, call: l.call, line: line(l.text), ok: true })
      let url = l.name == 'app_deploy' ? addressed(l.text) : null
      if (url) out.push({ built: url })
    }
  }
  return out
}

// The Beat a build reports, as the frame the page draws. `done` carries the
// last sentence, which is the refusal where there was one — and a refusal is
// also said as a builder's line, because that is what the loop wrote into the
// conversation (builder.ts `end`) and a replay would say it that way. So the
// live stream and the replay are the same sequence, and `done` is only ever
// the mark that the turn is over.
let framed = (b: Beat): Frame[] =>
  b.beat == 'said'
    ? [{ said: 'builder', text: b.text }]
    : b.beat == 'tool'
    ? [{ tool: b.name, call: b.call, line: line(b.args) }]
    : b.beat == 'ran'
    ? [
      { ran: b.name, call: b.call, line: line(b.text), ok: b.ok },
      ...(b.name == 'app_deploy' && b.ok && addressed(b.text)
        ? [{ built: addressed(b.text)! }]
        : []),
    ]
    : [
      ...(b.refused ? [{ said: 'builder', text: b.text } as Frame] : []),
      { done: b.text, ...(b.refused ? { refused: b.refused } : {}) },
    ]

// The conversation, one row per line, in the order it was said.
let SAID: CreateTable = {
  t: 'create table',
  name: 'said',
  ifNot: true,
  cols: [
    { name: 'n', type: 'integer', pk: true, autoincrement: true },
    { name: 'json', type: 'text', notNull: true },
  ],
}

export class Builder {
  #ctx: State
  #sql: Driver
  #env: Env
  #operator?: Promise<import('./operator.ts').Operator>
  // What the pages watching the Operator are told, once it is at work.
  #frames?: ReturnType<typeof import('./operator-host.ts').operatorFrames>
  // Whether a build is running in this object right now. In memory on purpose:
  // an object that was evicted has no build running, and a flag in storage
  // would outlive the loop it stands for and lock the space forever.
  #building = false
  #arming?: Promise<void>
  // The browsers people lend the Operator, and the calls asked of them that
  // wait for an answer: in memory, as the step waiting on one is.
  #lent: Browsers

  constructor(ctx: State, env: Env) {
    this.#ctx = ctx
    this.#sql = driver(ctx.storage)
    this.#env = env
    this.#sql.query(SAID)
    this.#lent = browsers(() => ctx.getWebSockets(), env.CLOCK)
  }

  /** The conversation so far, whole. */
  said(): Line[] {
    return this.#sql
      .query(select({
        cols: [col('json')],
        from: table('said'),
        order: [col('n')],
      }))
      .map((r) => JSON.parse(String(r.json)) as Line)
  }

  #keep(said: Line[]) {
    for (let l of said) {
      this.#sql.query({
        t: 'insert',
        into: 'said',
        cols: ['json'],
        rows: [[val(JSON.stringify(l))]],
      })
    }
  }

  /**
   * The whole conversation, gone, and the object born again on the spot
   * (T-34371). This is what a deleted space takes with it: the transcript
   * lives in this object's own SQLite and nowhere else, so the directory
   * tombstone that buries every app, deploy and membership of the space
   * cannot reach it — `/privacy` says a closed space takes its things with it,
   * and erase.ts calls this so the sentence is true.
   *
   * Idempotent, because a delete that died halfway is finished by asking
   * again (erase.ts order): emptying an empty object empties it again. The
   * table is planted back so the next space at this name — the eid is fresh,
   * but nothing here relies on that — wakes with a schema rather than none.
   *
   * The sockets are left where they are: a page still holding one is watching
   * a space that no longer exists, and the next line it says is answered
   * "that space is gone" by {@link Builder.say}, which reads the directory.
   */
  async wipe() {
    await this.#ctx.storage.deleteAll()
    this.#sql.query(SAID)
    this.#operator = undefined
    this.#frames = undefined
  }

  // Everyone watching this space, including the socket the frame came in on: a
  // build is the space's, not one tab's, so a second tab sees it happen too.
  #tell(frames: Frame[]) {
    for (let ws of this.#builds()) {
      for (let f of frames) {
        try {
          ws.send(JSON.stringify(f))
        } catch {
          // A socket that has gone away is not this build's problem.
        }
      }
    }
  }

  /**
   * A socket, accepted: what a page hears the moment it joins. The whole
   * conversation as frames, then `ready` — so a reload replays and a first
   * visit hears nothing but `ready`.
   */
  joined(ws: Wire, held: Held) {
    ws.serializeAttachment(held)
    for (let f of frames(this.said())) ws.send(JSON.stringify(f))
    ws.send(JSON.stringify({ ready: true, building: this.#building }))
  }

  /** The space this object is for, read fresh — its tier and its month's
   * builds decide what the loop may do, and both move under it. Straight at
   * the meta store, the way a store reads the directory (meter.ts): an object
   * is handed the namespace and no service binding. */
  #space(eid: string): Promise<Space | null> {
    let ns = this.#env.STORE
    return directory({
      fetch: (req: Request) => dirPart.fetch(req, { STORE: ns }),
    }).at(eid)
  }

  /**
   * One line from a person: the build it starts, and the frames it casts. What
   * it answers is the turn's last frame — `{done}` or `{busy}` — for the door
   * below, which waits for the round rather than listening to it. Everyone on
   * a socket has already heard it.
   *
   * One at A time, and the flag is raised before the first `await` on purpose:
   * two frames a moment apart are two handlers interleaving at every await, so
   * a check that yielded first would let both builds start.
   */
  async say(held: Held, text: string): Promise<Frame> {
    if (this.#building) return this.#say([{ busy: WAIT }])
    this.#building = true
    try {
      let space = await this.#space(held.space)
      if (!space) return this.#say([{ done: 'that space is gone' }])
      let who: Who = { person: held.person, role: held.role }
      let asked: Line = { said: 'person', text }
      let was = this.said()
      this.#keep([asked])
      this.#tell([{ said: 'person', text }])
      let end: Frame = { done: '' }
      // The loop and its tools load with the first build, not with every
      // isolate that wakes this object (T-37977).
      let { build } = await import('./builder.ts')
      let out = await build(this.#env, who, space, [...was, asked], {
        on: (b) => {
          let cast = framed(b)
          if (b.beat == 'done') end = cast[cast.length - 1]
          this.#tell(cast)
        },
      })
      // What the loop added to what it was handed: the person's line is
      // already kept, so the transcript and the loop agree on one history.
      this.#keep(out.lines.slice(was.length + 1))
      return end
    } catch (e) {
      // The loop answers its own refusals in sentences; anything that reaches
      // here is ours breaking, and the person is owed a sentence for that too.
      caught(e, { request: 'build', space: held.space })
      return this.#say([{
        done: 'Something of ours broke. Nothing was built.',
      }])
    } finally {
      this.#building = false
    }
  }

  // A frame told to everyone and handed back to the caller: the two endings
  // that never reach the loop.
  #say(frames: Frame[]): Frame {
    this.#tell(frames)
    return frames[0]
  }

  /**
   * The object's door: the handshake, the line a browser with no script posts,
   * and the wipe a space's death asks for. Who is asking is the kernel's word
   * (apps.ts vouches it the way it vouches a store request) — this object is
   * never reached from the internet.
   */
  async fetch(request: Request): Promise<Response> {
    // A caller on a later deploy restarts this object first, but only an idle
    // one: a build in flight (a model call can take minutes) or a page's
    // socket is never cut for it, and keeps the code it started on.
    if (!this.#building && !this.#builds().length) {
      await behind(request.headers, this.#env.CF_VERSION_METADATA, this.#ctx)
    }
    let url = new URL(request.url)
    if (url.pathname == '/wipe') {
      // Nobody's but the kernel's, and no person's at all: the space is being
      // deleted and there may be no membership left to read. The header cannot
      // arrive from outside — `joining` strips it from the request it carries
      // over, the way door.ts strips it at a store's door.
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      await this.wipe()
      return Response.json({ ok: true })
    }
    if (url.pathname.startsWith('/operator/')) {
      try {
        // A reply to the Operator's letter is the kernel's to bring (inbox.ts),
        // and is asked by no person.
        if (
          url.pathname == '/operator/receipt' ||
          url.pathname == '/operator/letter' ||
          url.pathname == '/operator/replied' ||
          url.pathname == '/operator/tell'
        ) {
          let space = request.headers.get(SPACE)
          if (request.headers.get('x-yak-kernel') != '1' || !space) {
            return no(403, NOBODY)
          }
          // What happened in the space, for its people's Updates
          // (operator-updates.ts `tell`).
          if (url.pathname == '/operator/tell') {
            let { notification } = await import('./operator-updates.ts')
            let { store } = await this.#work()
            await store.g.apply([notification(await request.json())], {
              trusted: true,
            })
            return Response.json({ ok: true })
          }
          if (url.pathname == '/operator/receipt') {
            let { operatorReceipt } = await import('./operator-host.ts')
            return await operatorReceipt(
              await this.#work(),
              await request.json(),
            )
          }
          let { operatorReply } = await import('./operator-host.ts')
          return await operatorReply(
            await this.#work(),
            space,
            url.pathname,
            await request.json(),
            () => this.#arming,
          )
        }
        return await this.#operate(request)
      } catch (e) {
        return no(
          refusing(e, { request: 'operator' }),
          e instanceof Error ? e.message : String(e),
        )
      }
    }
    if (url.pathname != '/ws' && url.pathname != '/say') {
      return no(404, 'no route')
    }
    if (
      url.pathname == '/ws' &&
      (request.headers.get('upgrade') ?? '').toLowerCase() != 'websocket'
    ) {
      return no(426, 'this is a WebSocket endpoint')
    }
    let person = request.headers.get('x-yak-person')
    let said = request.headers.get('x-yak-role')
    let space = request.headers.get(SPACE)
    if (!person || !space) return no(401, NOBODY)
    // The same word the rest of the platform asks: a member who writes
    // (@yaks/member). A build makes an app and deploys it — nothing a reader
    // may do.
    let role = said ? level(said) : null
    if (!writes(role)) return no(403, NOT_A_WRITER)
    let held: Held = { person, role, space }
    return url.pathname == '/say'
      ? await this.#round(request, held)
      : this.#accept(held)
  }

  async #operate(request: Request): Promise<Response> {
    let person = request.headers.get('x-yak-person')
    let spaceId = request.headers.get(SPACE)
    if (!person || !spaceId) return no(401, NOBODY)
    let space = await this.#space(spaceId)
    if (!space) return no(404, 'that space is gone')
    let dir = directory({
      fetch: (req: Request) => dirPart.fetch(req, this.#env),
    })
    let access = await dir.page(
      space.slug,
      null,
      person,
      request.headers.get('x-yak-administrative') == '1',
    )
    let role = access.administrative ? 'owner' as const : access.role ?? null
    if (!writes(role)) return no(403, NOT_A_WRITER)
    if (new URL(request.url).pathname == '/operator/browser') {
      return this.#accept({ browser: true, person, space: spaceId }, request)
    }
    let operator = await this.#work()
    if (new URL(request.url).pathname == '/operator/call') {
      let { answering } = await import('./operator-calls.ts')
      return answering(
        this.#env,
        operator,
        space,
        JSON.parse(request.headers.get('x-yak-call') ?? '{}'),
        () => this.#arming,
      )
    }
    if (new URL(request.url).pathname == '/operator/ws') {
      return this.#accept({
        person,
        role,
        space: spaceId,
        administrative: access.administrative,
        called: space.operator,
        opens: managePath('operator', space.slug),
        operator: true,
      })
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
      operator,
      held,
      new URL(request.url).pathname,
      args,
      () => this.#arming,
      (bundles) => this.#frames?.drafts(held, bundles),
    )
    if (response) return response
    // Its steps run on the pool, as every other Operator session's do: words
    // given while it works land in it.
    return Response.json(await operator.run(held, space, args))
  }

  #work() {
    return this.#operator ??= (async () => {
      let { operatorStore } = await import('./operator-store.ts')
      let { attachmentTools, handleChannels } = await import(
        './operator-channels.ts'
      )
      let { operating } = await import('./operator.ts')
      let { operatorFrames } = await import('./operator-host.ts')
      // A write that owes work starts it now, beside a step in flight, so a
      // person's words reach the session they are for at once; the alarm is
      // there for what this wake leaves.
      let nudge = () => {
        this.#arming = this.#ctx.storage.setAlarm(Date.now())
        store.fx.work(store.g).catch((e) =>
          caught(e, { request: 'operator effects' })
        )
      }
      let store = operatorStore(this.#ctx.storage, {
        version: this.#env.CF_VERSION_METADATA?.id,
        report: (e, where) =>
          caught(e, { request: 'operator effects', handler: where.handler }),
        nudge,
      })
      let frames = this.#frames = operatorFrames(
        store,
        () => this.#ctx.getWebSockets(),
        (person) => operator.named(person),
      )
      let operator = operating(store, this.#env, {
        tools: attachmentTools(this.#env),
        browsers: this.#lent,
        tell: (session) =>
          void frames.tell(session).catch((e) =>
            caught(e, { request: 'operator socket' })
          ),
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
      // An incarnation takes up what the one before it left: a step a deploy
      // reset under its reply runs again at once, on the first request (a page
      // reconnecting) rather than whenever the person next says something.
      // Worked here, not only armed: an alarm the reset cut off can hold the
      // next one back for minutes.
      nudge()
      return operator
    })()
  }

  // The sockets of pages watching a build (pages.ts `chat`), not the
  // Operator's: a page watching the Operator, or a browser lent to it, is cut
  // by a restart and joins again, and never holds this object on old code.
  #builds() {
    return this.#ctx.getWebSockets().filter((ws) => {
      let held = ws.deserializeAttachment() as
        | { operator?: boolean; browser?: boolean }
        | null
      return !held?.operator && !held?.browser
    })
  }

  async alarm() {
    let { drain, woken } = await import('./operator-store.ts')
    let { store } = await this.#work()
    await woken(this.#ctx.storage, () => drain(store))
  }

  /**
   * A line from a browser with no socket: the round waited for, and the whole
   * conversation answered as the frames a page draws — the replay a socket
   * would have heard, plus the `{done}` or `{busy}` this line came to. The
   * page is pages.ts's; this is the same wire, said once instead of streamed.
   */
  async #round(request: Request, held: Held): Promise<Response> {
    let asked = await request.json() as { say?: unknown }
    let text = typeof asked.say == 'string' ? asked.say.trim() : ''
    if (!text) return no(400, 'say what you want built')
    let end = await this.say(held, text)
    return Response.json({ frames: [...frames(this.said()), end] })
  }

  // The 101, and the socket handed to the runtime so it outlives this object.
  // A browser's socket speaks the platform's subprotocol, which the 101 names
  // as a browser requires (identity.ts `PROTOCOL`).
  #accept(held: Socket, request?: Request): Response {
    let pair = new WebSocketPair()
    this.#ctx.acceptWebSocket(pair[1])
    if ('browser' in held) pair[1].serializeAttachment(held)
    else if (held.operator) {
      pair[1].serializeAttachment(held)
      pair[1].send(JSON.stringify({ ready: true }))
    } else this.joined(pair[1], held)
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

  /** A frame from a page. The only one it may send is `{say}`. */
  webSocketMessage(ws: Wire, data: string | ArrayBuffer): void {
    let held = ws.deserializeAttachment() as Socket | null
    // A lent browser answers the calls asked of it (operator-browser.ts).
    if (held && 'browser' in held) return this.#lent.heard(held, data)
    // A page watching the Operator says nothing on its socket.
    if (held?.operator) return
    if (!held?.person) return void ws.send(JSON.stringify({ done: NOBODY }))
    let said = read(data)
    if (said == null) return
    // The build outlives this handler; the runtime keeps the object alive for
    // the promise, and every frame it casts goes to the sockets rather than
    // back through this return.
    this.say(held, said).catch((e) =>
      caught(e, { request: 'build', space: held.space })
    )
  }

  /** A socket closed. A lent browser's calls fail at once, rather than
   * waiting out the person. */
  webSocketClose(ws: Wire): void {
    let held = ws.deserializeAttachment() as Socket | null
    if (held && 'browser' in held) this.#lent.gone(ws)
  }
}

// A frame from a page, as far as it is anybody's business: the one word it may
// say. Junk is nobody's line and is ignored rather than answered.
let read = (data: string | ArrayBuffer): string | null => {
  try {
    let said = JSON.parse(typeof data == 'string' ? data : '')
    let text = said?.say
    return typeof text == 'string' && text.trim() ? text : null
  } catch {
    return null
  }
}

let no = (status: number, message: string) =>
  Response.json({ error: 'Refused', message }, { status })

// The runtime's socket factory, declared structurally so this file needs no
// Cloudflare dependency to compile (the same declaration @yaks/durable-object
// makes for the same reason).
declare let WebSocketPair: { new (): { 0: unknown; 1: Wire } }
