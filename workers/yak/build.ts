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
//                   {busy}                       a build is already running,
//                                                or the line is kept for later
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
import type { Hibernation, Wire } from '@yaks/durable-object'
import { driver, type DurableStorage, freely } from '@yaks/durable-object/sql'
import {
  bounded,
  type Ceiling,
  type Stopped,
} from '@yaks/durable-object/ceiling'
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
import { behind, onceRead, type Restartable } from './running.ts'
import * as dirPart from './directory.ts'
import type { Settings } from './operator-persona.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { caught, refusing, stopped } from './defects.ts'
import { refuse } from '@yaks/api/refuse'
import { reported, type Tally, tallying } from './lib/hops.ts'
import * as log from './writes.ts'
import { headed } from './timing.ts'
import { type Browsers, browsers, type Lent } from './operator-browser.ts'
import { PROTOCOL, protocolled } from './protocol.ts'
import { managePath } from './route.ts'
import { WAKE } from './door.ts'
import { COPY, copying } from './store-copy.ts'
import {
  type Frame,
  HELD,
  type Held,
  NOBODY,
  NOT_A_WRITER,
  OWED,
  sayer,
  saying,
  seatOf,
  SPACE,
  WAIT,
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
  // Work still going after an answer or an alarm returns: an object's own
  // keeps it running, and a test's platform waits on it (`settled`).
  waitUntil?(work: Promise<unknown>): void
}

// Who is at a socket, and whether the page is watching the Operator rather
// than a build, or is a browser lent to the Operator (operator-browser.ts).
type Watching = Held & { operator?: boolean }
type Socket = Watching | Lent

// One line about a tool, for somebody watching rather than reading: the first
// line of it, and not much of that. A tool answers a paragraph; a page draws a
// row.
let CUT = 120

// How long a kept line no turn could take up waits before it is tried again.
let AGAIN = 60_000

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
  // What a read of the Operator needs, made without it (`#stored`).
  #store?: Promise<
    Pick<import('./operator.ts').Operator, 'store' | 'named' | 'stop'>
  >
  // What the pages watching the Operator are told, once it is at work.
  #frames?: ReturnType<typeof import('./operator-host.ts').operatorFrames>
  // The build running in this object right now, if one is. In memory on
  // purpose: an object that was evicted has no build running, and a flag in
  // storage would outlive the loop it stands for and lock the space forever.
  #building?: Promise<unknown>
  // What this object's statements may cost before it stops until a window
  // ends (@yaks/durable-object `bounded`): a line said meanwhile is kept
  // (`#hold`), and taken up once the window ends (`#replay`).
  #ceiling: Ceiling
  // The kept lines being taken up, one turn at a time, and whether a line
  // was kept while a build ran, for its end to take up.
  #replaying?: Promise<void>
  #queued = false
  #arming?: Promise<void>
  // The Operator's pool, once this incarnation has made it (`#work`).
  #fx?: { running(): unknown[] }
  // The alarm's work (operator-store.ts `waking`), one at a time.
  #wake?: (work: () => Promise<number | null>) => Promise<void>
  // When the Operator's work stops starting runs (operator-store.ts `SLICE`),
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
  // Whether the build's conversation's table stands. Made when it is first
  // asked about, so a wake of the Operator alone writes nothing before its
  // answer: a write holds an object's answer until storage confirms it.
  #raised = false
  // The browsers people lend the Operator, and the calls asked of them that
  // wait for an answer: in memory, as the step waiting on one is.
  #lent: Browsers

  constructor(ctx: State, env: Env) {
    this.#ctx = ctx
    this.#ceiling = bounded(ctx.storage)
    this.#sql = driver(ctx.storage)
    this.#env = env
    this.#lent = browsers(() => ctx.getWebSockets(), env.CLOCK)
  }

  // The build's conversation's table, made when it is first asked about
  // (`#raised`).
  #table() {
    if (!this.#raised) this.#sql.query(SAID)
    this.#raised = true
  }

  /** The conversation so far, whole. */
  said(): Line[] {
    this.#table()
    return this.#sql
      .query(select({
        cols: [col('json')],
        from: table('said'),
        order: [col('n')],
      }))
      .map((r) => JSON.parse(String(r.json)) as Line)
  }

  #keep(said: Line[]) {
    this.#table()
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
   * table is made again by whatever next asks about the conversation.
   *
   * The sockets are left where they are: a page still holding one is watching
   * a space that no longer exists, and the next line it says is answered
   * "that space is gone" by {@link Builder.say}, which reads the directory.
   */
  async wipe() {
    await this.#ctx.storage.deleteAll()
    this.#raised = false
    this.#operator = undefined
    this.#store = undefined
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
    ws.send(JSON.stringify({ ready: true, building: !!this.#building }))
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
   * it answers is how the round ended beyond what the conversation keeps —
   * `{done}`, `{busy}`, or the line kept for later — for the door below,
   * which waits for the round rather than listening to it. Everyone on a
   * socket has already heard it.
   *
   * One at a time, and the build is raised before the first `await` on
   * purpose: two frames a moment apart are two handlers interleaving at every
   * await, so a check that yielded first would let both builds start.
   *
   * A line said while this object is stopped is kept (`#hold`); a line said
   * to one that is not pays a look in memory for that.
   */
  async say(held: Held, text: string): Promise<Frame[]> {
    let stop = this.#ceiling.refusal(true)
    if (stop || this.#building) return await this.#hold(held, text, stop)
    return await this.#turn(held, text)
  }

  // A build, raised as `#building` until it ends, when what was said while
  // it ran is taken up. A kept line names its place in the log (`kept`),
  // which it leaves as the conversation takes it.
  #turn(held: Held, text: string, kept?: number): Promise<Frame[]> {
    let turn = this.#build(held, text, kept)
    this.#building = turn
    return turn.finally(() => {
      this.#building = undefined
      if (this.#queued) this.#replay()
    })
  }

  async #build(held: Held, text: string, kept?: number): Promise<Frame[]> {
    let heard = false
    try {
      let space = await this.#space(held.space)
      if (!space) {
        // A kept line goes with its space.
        if (kept != null) log.done(this.#sql, kept)
        return this.#say([{ done: 'that space is gone' }])
      }
      let who: Who = { person: held.person, role: held.role }
      let asked: Line = { said: 'person', text }
      let was = this.said()
      // A kept line was told as it was kept, and leaves the log in the
      // transaction the conversation takes it in.
      if (kept == null) this.#keep([asked])
      else {
        this.#sql.tx!(() => {
          this.#keep([asked])
          log.done(this.#sql, kept)
        })
      }
      heard = true
      if (kept == null) this.#tell([{ said: 'person', text }])
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
      // Kept as the line was, through a window the loop's work passed: the
      // answer to what a person said is theirs too (M-59093).
      let reply = out.lines.slice(was.length + 1)
      this.#ceiling.free(() => this.#keep(reply))
      return [end]
    } catch (e) {
      // Stopped before the conversation took the line, it is kept, or a kept
      // one stays where it is (`#replays`).
      if (stopped(e) && !heard) {
        return kept == null ? await this.#hold(held, text, e) : []
      }
      // The loop answers its own refusals in sentences; anything that reaches
      // here is ours breaking, and the person is owed a sentence for that too.
      caught(e, { request: 'build', space: held.space })
      return this.#say([{
        done: 'Something of ours broke. Nothing was built.',
      }])
    }
  }

  // Frames told to everyone and handed back to the caller: the endings that
  // never reach the loop.
  #say(frames: Frame[]): Frame[] {
    this.#tell(frames)
    return frames
  }

  /** A line this object can't answer now: said while it may not write
   * (`#ceiling`, `stop`), or while a build runs. Kept in the write log, which
   * the ceiling lets through (`free`), and taken up as a turn of its own once
   * the window ends, by the alarm armed for then, or once the build ends
   * (`#replay`), with the alarm a minute on in case this object dies under
   * it. Everyone watching sees it said, and when it will be answered. */
  async #hold(
    held: Held,
    text: string,
    stop: Stopped | null,
  ): Promise<Frame[]> {
    this.#ceiling.free(() => {
      for (let stmt of log.schema()) this.#sql.query(stmt)
      log.keep(this.#sql, saying(held, text), JSON.stringify({ say: text }))
    })
    this.#queued ||= !stop
    let told = this.#say([
      { said: 'person', text },
      { busy: stop ? HELD(Math.ceil(stop.retry.after / 1000)) : WAIT },
    ])
    await this.#rest(stop ? stop.retry.after : AGAIN)
    return told
  }

  // The alarm, `ms` from now, or sooner where another need armed it so.
  #rest = async (ms: number) => {
    let { sooner } = await import('./operator-store.ts')
    await sooner(this.#ctx.storage, Date.now() + ms)
  }

  // The lines kept (`#hold`), taken up behind the alarm or the build that
  // ended, since a build takes minutes. A stopped object's wait for them is
  // its alarm's. A log that holds none is looked at once an incarnation
  // (writes.ts `next`), and stands from the store's fitting
  // (operator-store.ts), so the look runs no DDL.
  #replay() {
    if (this.#replaying || this.#ceiling.stopped(true)) return
    this.#queued = false
    let going = this.#replaying = (async () => {
      if (log.waiting(this.#sql)) await this.#replays()
    })()
      .catch((e) => caught(e, { request: 'build replay' }))
      .finally(() => this.#replaying = undefined)
    this.#ctx.waitUntil?.(going)
  }

  // Oldest first, a turn each once no other build is running. One the
  // window stops waits for its end, and every line behind it with it; one no
  // turn took up (its directory unreachable) waits a minute.
  async #replays() {
    let last: number | undefined
    for (let k = log.next(this.#sql); k; k = log.next(this.#sql)) {
      if (k.seq == last) return await this.#rest(AGAIN)
      last = k.seq
      let asked = log.replayed(k, 'http://builder/say')
      let { say } = await asked.json() as { say: string }
      while (this.#building) await this.#building.catch(() => {})
      if (!this.#ceiling.stopped(true)) {
        await this.#turn(sayer(asked.headers), say, k.seq)
      }
      let wait = this.#ceiling.stopped(true)
      if (wait) return await this.#rest(wait)
    }
  }

  /**
   * The object's door: the handshake, the line a browser with no script posts,
   * and the wipe a space's death asks for. Who is asking is the kernel's word
   * (apps.ts vouches it the way it vouches a store request) — this object is
   * never reached from the internet.
   */
  /** An answer, with what its work cost the caller's Server-Timing: the
   * round trips and waits behind it, as a store's carries them (hops.ts
   * `reported`, door.ts `metered`). */
  async fetch(request: Request): Promise<Response> {
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
    // A caller on a later deploy restarts this object first, but only an idle
    // one: a build in flight (a model call can take minutes), an Operator's
    // step under way or a page's socket is never cut for it, and keeps the
    // code it started on.
    if (
      !this.#building && !this.#builds().length && !this.#fx?.running().length
    ) {
      await behind(request.headers, this.#env.CF_VERSION_METADATA, this.#ctx)
    }
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
    if (url.pathname == '/wipe') {
      // Nobody's but the kernel's, and no person's at all: the space is being
      // deleted and there may be no membership left to read. The header cannot
      // arrive from outside — `joining` strips it from the request it carries
      // over, the way door.ts strips it at a store's door.
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      await this.wipe()
      return Response.json({ ok: true })
    }
    if (url.pathname == COPY) {
      // The platform's admin's, through the kernel (sweep.ts): a read of the
      // file as it stands, made by no Operator, counted and never stopped.
      if (request.headers.get('x-yak-kernel') != '1') return no(403, NOBODY)
      return Response.json(
        copying(freely(this.#ctx.storage), await request.json()),
      )
    }
    if (url.pathname.startsWith('/result/')) {
      if (
        request.headers.get('x-yak-kernel') != '1' ||
        !request.headers.get(SPACE)
      ) return no(403, NOBODY)
      let args = await request.json() as Record<string, unknown>
      if (typeof args.reader != 'string' || !args.reader) return no(403, NOBODY)
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
    if (url.pathname.startsWith('/operator/')) {
      try {
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
            let { store } = await this.#stored()
            await store.g.apply([notification(await request.json())], {
              trusted: true,
            })
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
    let reading = this.#stored()
    reading.catch(() => {})
    // The space and the person's seat in it, as the kernel read them; read
    // here, in one read, for a caller that read none. Read here for every
    // request, it was a round trip on each chat page, asked only once a new
    // incarnation had made its Operator: a runtime sends a request when the
    // code before it yields (T-149700).
    let access = seatOf(request.headers) ?? await directory({
      fetch: (req: Request) => dirPart.fetch(req, this.#env),
    }).seat(
      spaceId,
      person,
      request.headers.get('x-yak-administrative') == '1',
    )
    let space = access.space
    if (!space) return no(404, 'that space is gone')
    let role = access.administrative ? 'owner' as const : access.role ?? null
    if (!writes(role)) return no(403, NOT_A_WRITER)
    if (new URL(request.url).pathname == '/operator/browser') {
      return this.#accept({ browser: true, person, space: spaceId }, request)
    }
    let read = await reading
    if (new URL(request.url).pathname == '/operator/call') {
      let { answering } = await import('./operator-calls.ts')
      return answering(
        this.#env,
        await this.#work(),
        space,
        JSON.parse(request.headers.get('x-yak-call') ?? '{}'),
        () => this.#arming,
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
    if (new URL(request.url).pathname == '/operator/ws') {
      let asked = new URL(request.url).searchParams
      let watching = {
        person,
        role,
        space: spaceId,
        administrative: access.administrative,
        called: space.operator,
        opens: managePath('operator', space.slug),
        operator: true,
        // Its lines sent as data, which it draws (operator-draw.ts `Lines`).
        lines: asked.has('lines'),
      }
      // The conversation the page was drawn with, whose standing its `ready`
      // says, read once the socket hears every step after it.
      let talk = asked.get('talk')
      let { standingAt } = await import('./operator-host.ts')
      return this.#accept(
        watching,
        undefined,
        talk ? () => standingAt(read.store, talk, watching) : undefined,
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
      (bundles) => this.#frames?.drafts(held, bundles),
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
        ),
      )
    }
    return Response.json(
      await (new URL(request.url).pathname == '/operator/helper'
        ? operator.helper(held, space, args)
        : operator.run(held, space, args)),
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
        let { operatorStore, owing, SLICE } = await import(
          './operator-store.ts'
        )
        let { operatorFrames } = await import('./operator-host.ts')
        // A write that owes work starts it now, beside a step in flight, so a
        // person's words reach the session they are for at once, within a
        // slice; the alarm is there for what this wake leaves. The work goes on
        // after the write answers, held by the object (`waitUntil`), once the
        // Operator whose handlers do it is made.
        let nudge = () => {
          this.#arming = this.#ctx.storage.setAlarm(Date.now())
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
        let store = operatorStore(this.#ctx.storage, {
          version: this.#env.CF_VERSION_METADATA?.id,
          report: (e, where) =>
            caught(e, { request: 'operator effects', handler: where.handler }),
          nudge,
        })
        this.#fx = store.fx
        owing(store.fx, () => this.#work())
        // What a person is called, as the Operator asks it (operator.ts
        // `named`).
        let named = (person: string) =>
          dirPart.directoryOf(this.#env.STORE).nameAt(person)
        this.#frames = operatorFrames(
          store,
          () => this.#ctx.getWebSockets(),
          named,
        )
        // An incarnation takes up what the one before it left: a step a deploy
        // reset under its reply runs again at once, on the wake its first
        // request's caller sends once it has the answer (a page reconnecting,
        // build-door.ts `builderOf`), rather than whenever the person next says
        // something. Worked, not only armed: an alarm the reset cut off can hold
        // the next one back for minutes.
        this.#owed = nudge
        return {
          store,
          named,
          // Stopping a task is the Operator's own.
          stop: async (task: string, by: string) =>
            (await this.#work()).stop(task, by),
        }
      },
    )
  }

  #work() {
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

  // A stopped object's alarm does nothing but come back when its window ends
  // (@yaks/durable-object `bounded`), and one stopped as it starts comes back
  // then too; one stopped as its work goes is `waking`'s.
  async alarm() {
    try {
      let wait = this.#ceiling.stopped(true)
      if (wait) await this.#rest(wait)
      else await this.#ring()
    } catch (e) {
      if (!stopped(e)) throw e
      await this.#rest(e.retry.after)
    }
  }

  async #ring() {
    let { drain, SLICE, waking } = await import('./operator-store.ts')
    let { store } = await this.#work()
    this.#resume()
    this.#replay()
    this.#wake ??= waking(
      this.#ctx.storage,
      (e) => caught(e, { request: 'operator alarm' }),
      (work) => this.#ctx.waitUntil?.(work),
    )
    await this.#wake(async () => {
      this.#draining = true
      try {
        let { attachmentBackfill } = await import('./attachment-move.ts')
        let { ownerBackfill } = await import('./owner-move.ts')
        let more = false
        let retry: number | undefined
        try {
          more = await attachmentBackfill(store, this.#env)
        } catch (e) {
          if (stopped(e)) throw e
          caught(e, { request: 'operator attachment backfill' })
          retry = Date.now() + 60_000
        }
        try {
          more = await ownerBackfill(store) || more
        } catch (e) {
          if (stopped(e)) throw e
          caught(e, { request: 'operator owner backfill' })
          retry = Date.now() + 60_000
        }
        let next = await drain(store, this.#until = Date.now() + SLICE)
        return more
          ? Date.now()
          : retry == null
          ? next
          : next == null
          ? retry
          : Math.min(next, retry)
      } finally {
        this.#draining = false
      }
    })
  }

  /**
   * A line from a browser with no socket: the round waited for, and the whole
   * conversation answered as the frames a page draws — the replay a socket
   * would have heard, plus the `{done}` or `{busy}` this line came to. The
   * page is pages.ts's; this is the same wire, said once instead of streamed.
   * A stopped object's conversation waits with it, and the page shows the
   * line it kept.
   */
  async #round(request: Request, held: Held): Promise<Response> {
    let asked = await request.json() as { say?: unknown }
    let text = typeof asked.say == 'string' ? asked.say.trim() : ''
    if (!text) return no(400, 'say what you want built')
    let end = await this.say(held, text)
    let before = this.#ceiling.stopped(false) ? [] : frames(this.said())
    return Response.json({ frames: [...before, ...end] })
  }

  // The 101, and the socket handed to the runtime so it outlives this object.
  // A browser's socket speaks the platform's subprotocol, which the 101 names
  // as a browser requires (identity.ts `PROTOCOL`). A page watching the
  // Operator is told it is ready with where the conversation it shows stands,
  // so it reads it again only when that moved (operator-host.ts `standingAt`).
  #accept(
    held: Socket,
    request?: Request,
    standing?: () => Promise<string | undefined>,
  ): Response {
    let pair = new WebSocketPair()
    this.#ctx.acceptWebSocket(pair[1])
    if ('browser' in held) pair[1].serializeAttachment(held)
    else if (held.operator) {
      let ws = pair[1]
      ws.serializeAttachment(held)
      let ready = (at?: string) =>
        ws.send(
          JSON.stringify(
            at == null ? { ready: true } : { ready: true, standing: at },
          ),
        )
      if (!standing) ready()
      else {
        void standing().then(ready, (e) => {
          caught(e, { request: 'operator socket' })
          ready()
        })
      }
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

// What `make` makes, held by the caller, unless the object was stopped
// (@yaks/durable-object `Stopped`) making it: then `forget` drops it, so the
// first call after the window makes it again. Any other failure stands.
let unstopped = <T>(forget: () => void, make: () => Promise<T>): Promise<T> => {
  let made = make()
  made.catch((e) => stopped(e) && forget())
  return made
}

let no = (status: number, message: string) =>
  Response.json({ error: 'Refused', message }, { status })

// The runtime's socket factory, declared structurally so this file needs no
// Cloudflare dependency to compile (the same declaration @yaks/durable-object
// makes for the same reason).
declare let WebSocketPair: { new (): { 0: unknown; 1: Wire } }
