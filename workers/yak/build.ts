// The builder's own object (T-34240): one Durable Object per SPACE, holding
// the conversation and running builder.ts's `build()` one at a time, with the
// page listening on a WebSocket. The loop is the last ticket's (T-34239); what
// is here is the place it happens and the wire it happens on.
//
// WHY AN OBJECT AT ALL. A build is a minute of tool calls, and the person is
// watching it: the words, each tool as it starts and as it answers, the
// address at the end. A Worker isolate cannot be that — the request that
// starts the build is not the one holding the socket, and there is no second
// place both can reach. One object per space is: every page of that space
// arrives at it, its memory is the conversation, and its single thread is what
// makes "one build at a time here" a fact rather than a lock.
//
// A PLAIN OBJECT, NOT THE AGENTS SDK. `agents` (the Agent class, hibernatable
// sockets, state sync) is the obvious fit and was tried first; four things
// sent it back, each checked against agents@0.22.0 rather than the docs:
//
//   1. its peers are this Worker's pins, moved — `zod ^4` where the MCP SDK
//      pins us to 3, `@modelcontextprotocol/sdk 1.30.0` exactly where we are
//      on 1.29.0 — so it installs only with --legacy-peer-deps;
//   2. `AIChatAgent`, the half that holds a transcript, has LEFT the package
//      (`agents/ai-chat-agent` throws at import) for `@cloudflare/ai-chat`,
//      whose own peers are `ai ^6||^7` and `@ai-sdk/react`;
//   3. its client is `agents/client` / `agents/react`, npm modules over the
//      AI SDK's UI-message stream — and OUR pages are hand-written ESM with
//      no build step, so the page could not import them and would be writing
//      those frames by hand anyway (T-34242);
//   4. `Agent extends DurableObject` from `cloudflare:workers`, which nothing
//      outside workerd can construct: every test here would become a
//      `wrangler dev` boot, where the object below runs in the same in-memory
//      stand-in the Store does (harness.ts) at a millisecond apiece.
//
// What it would have replaced is the forty lines under `#accept` and
// `#frames`. The SDK is the right answer the day our pages take a build step —
// its React chat client is the payoff — and none of that is true today.
//
// THE TRANSCRIPT LIVES HERE, in the object's own SQLite, and not as entities
// in the space's home store: the builder's whole reason to exist is a person
// who has NO app yet, so there is no app store to write to, and a conversation
// that shipped nothing is not somebody's data to keep, quota and bill. What a
// build produces — the app, its files, the deploy — is already in the graph,
// written by the tools as the person.
//
// THE WIRE is one JSON frame per event, and the KEY names the frame:
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
import type { DurableSql, Hibernation, Wire } from '@yaks/durable-object'
import { type Level, level, writes } from '@yaks/member'
import { type Beat, build, type Line } from './builder.ts'
import { directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'

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
export type State = Hibernation & { storage: { sql: DurableSql } }

/** What a socket remembers about itself across a hibernation: who is on the
 * other end, and which space they opened it in. The attachment is the only
 * memory a socket has, and 2KB is far more than these three want. */
export type Held = { person: string; role: Level | null; space: string }

/** The header the kernel names the space with at the handshake — the object's
 * own name is that eid, and this is how it learns it. */
export let SPACE = 'x-space-eid'

/** Where the page finds it: a SPACE's own address, ahead of every app in it
 * (router.ts PLATFORM_PATHS `/api/*`), because a person with no app yet is
 * exactly who the builder is for. */
export let BUILD = '/api/build'

/** A second build, asked for while the first is running. A wait, said as the
 * builder says everything: a sentence. */
export let WAIT =
  'I am still building the last thing you asked for — let me finish, and ' +
  'then say that again.'

/** Nobody is refused at the handshake rather than mid-conversation. */
export let NOBODY = 'sign in to build here'
export let NOT_A_WRITER = 'only a member who writes can build here'

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

/** A frame, as it goes down the socket. One key names it. */
export type Frame =
  | { said: 'person' | 'builder'; text: string }
  | { tool: string; call: string; line: string }
  | { ran: string; call: string; line: string; ok: boolean }
  | { built: string }
  | { done: string; refused?: string }
  | { ready: true; building: boolean }
  | { busy: string }

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
// last sentence, which is the refusal where there was one.
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
    : [{ done: b.text, ...(b.refused ? { refused: b.refused } : {}) }]

// The conversation, one row per line, in the order it was said.
let SAID = `create table if not exists said (
    n integer primary key autoincrement,
    json text not null
  )`

export class Builder {
  #ctx: State
  #env: Env
  // Whether a build is running in this object right now. In memory on purpose:
  // an object that was evicted has no build running, and a flag in storage
  // would outlive the loop it stands for and lock the space forever.
  #building = false

  constructor(ctx: State, env: Env) {
    this.#ctx = ctx
    this.#env = env
    ctx.storage.sql.exec(SAID)
  }

  /** The conversation so far, whole. */
  said(): Line[] {
    return this.#ctx.storage.sql
      .exec('select json from said order by n')
      .toArray()
      .map((r) => JSON.parse(String((r as { json: unknown }).json)) as Line)
  }

  #keep(said: Line[]) {
    for (let l of said) {
      this.#ctx.storage.sql.exec(
        'insert into said (json) values (?)',
        JSON.stringify(l),
      )
    }
  }

  // Everyone watching this space, including the socket the frame came in on: a
  // build is the space's, not one tab's, so a second tab sees it happen too.
  #tell(frames: Frame[]) {
    for (let ws of this.#ctx.getWebSockets()) {
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
    }, true).at(eid)
  }

  /**
   * One line from a person: the build it starts, and the frames it casts.
   *
   * ONE AT A TIME, and the flag is raised before the first `await` on purpose:
   * two frames a moment apart are two handlers interleaving at every await, so
   * a check that yielded first would let both builds start.
   */
  async say(held: Held, text: string) {
    if (this.#building) return this.#tell([{ busy: WAIT }])
    this.#building = true
    try {
      let space = await this.#space(held.space)
      if (!space) return this.#tell([{ done: 'that space is gone' }])
      let who: Who = { person: held.person, role: held.role }
      let asked: Line = { said: 'person', text }
      let was = this.said()
      this.#keep([asked])
      this.#tell([{ said: 'person', text }])
      let out = await build(this.#env, who, space, [...was, asked], {
        on: (b) => this.#tell(framed(b)),
      })
      // What the loop added to what it was handed: the person's line is
      // already kept, so the transcript and the loop agree on one history.
      this.#keep(out.lines.slice(was.length + 1))
    } catch (e) {
      // The loop answers its own refusals in sentences; anything that reaches
      // here is ours breaking, and the person is owed a sentence for that too.
      console.error('builder: the loop threw', e)
      this.#tell([{ done: 'Something of ours broke. Nothing was built.' }])
    } finally {
      this.#building = false
    }
  }

  /**
   * The object's door: the handshake, and nothing else. Who is asking is the
   * kernel's word (apps.ts vouches it the way it vouches a store request) —
   * this object is never reached from the internet.
   */
  fetch(request: Request): Response {
    let url = new URL(request.url)
    if (url.pathname != '/ws') return no(404, 'no route')
    if ((request.headers.get('upgrade') ?? '').toLowerCase() != 'websocket') {
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
    return this.#accept({ person, role, space })
  }

  // The 101, and the socket handed to the runtime so it outlives this object.
  #accept(held: Held): Response {
    let pair = new WebSocketPair()
    this.#ctx.acceptWebSocket(pair[1])
    this.joined(pair[1], held)
    return new Response(
      null,
      { status: 101, webSocket: pair[0] } as ResponseInit & {
        webSocket: unknown
      },
    )
  }

  /** A frame from a page. The only one it may send is `{say}`. */
  webSocketMessage(ws: Wire, data: string | ArrayBuffer): void {
    let held = ws.deserializeAttachment() as Held | null
    if (!held?.person) return void ws.send(JSON.stringify({ done: NOBODY }))
    let said = read(data)
    if (said == null) return
    // The build outlives this handler; the runtime keeps the object alive for
    // the promise, and every frame it casts goes to the sockets rather than
    // back through this return.
    this.say(held, said).catch((e) => console.error('builder: say', e))
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

/** This space's object. The name is the space's eid, which never moves — a
 * slug does. */
export let builderOf = (env: Env, space: string) =>
  env.BUILDER.get(env.BUILDER.idFromName(space))

/**
 * The handshake, carried to the object with the kernel's own vouch on it and
 * nothing of the client's. apps.ts is the only caller: `/api/build` on a
 * space's hostname. The upgrade request IS the init, which is how the
 * `Upgrade` header reaches the object (door.ts, same reason).
 */
export let joining = (env: Env, space: string, req: Request, who: Who) => {
  let out = new Request('http://builder/ws', req)
  for (let h of [SPACE, 'x-yak-person', 'x-yak-role']) out.headers.delete(h)
  out.headers.set(SPACE, space)
  if (who.person) out.headers.set('x-yak-person', who.person)
  if (who.role) out.headers.set('x-yak-role', who.role)
  return builderOf(env, space).fetch(out)
}
