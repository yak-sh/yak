// The agent door's other half: the stream a client leaves open to HEAR from
// the server between its own calls (T-32686, T-32734). Streamable HTTP gives
// a session two channels — the POST that carries a call and its reply, and a
// GET the client holds open as Server-Sent Events — and what goes down the
// GET is news the server has between calls: `notifications/<list>/
// list_changed` when an app of the person's own moves what they can reach
// (declared.ts), `notifications/message` when something of theirs broke
// (unseen.ts), and the release news below (`crossed`) when the platform
// itself moved. The person's agent listed the tools once at connect; this is
// how it learns to list them again.
//
// The stream lives in a DURABLE OBJECT, one per signed-in person — the
// McpAgent shape mcp.ts's header names, arrived at. The first cut queued the
// news in plain isolate memory, because a response body belongs to the
// request that made it and writing to it from the request that deployed the
// app would be "I/O on behalf of a different request". That works only when
// the deploy and the open stream land on the same isolate, which in
// production they rarely do. A Durable Object is ONE place: every request for
// this person is routed to this object, and the object's own I/O context owns
// the open streams, so the request that deployed the app can write to the
// stream the GET opened. Everything else stays stateless — a POST is still
// one call in, one JSON out, and this object is asked only for this.
//
// The news is a LOG, not a fanout: each line takes a monotonic event id, the
// last few are kept in the object's storage, and a stream that drops
// reconnects with `Last-Event-ID` and is handed what it missed (the MCP
// transport's resumability). So the object being evicted between two deploys
// costs nothing, and neither does a connection that blinked.
//
// One log per person, one cursor per stream, and at most one copy of a line
// per session: the transport forbids broadcasting one message across two
// streams of the SAME session, while two sessions are two clients and each
// needs its own copy. A stream that names no session is a client that was
// never told an id, and every one of those hears — they cannot be told apart,
// and silence is the worse failure.
import { VERSION } from '../../src/version.ts'
import type { Env } from './env.ts'
import type { Namespace, Stub } from './door.ts'

// The slice of the Durable Object runtime this object touches, structurally,
// so `deno check` reads it without @cloudflare/workers-types.
type Kv = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
}
type State = { storage: Kv }

// What one person's log holds: a notification says "your list moved", so many
// of them say nothing more than one.
let DEEP = 8
// How long a stream may sit quiet before it says something anyway, so the
// connection is not dropped as idle by whatever is in the middle.
let BEAT = 30_000

type Line = { id: number; frame: string }
type News = { seq: number; lines: Line[] }
type Told = { method: string; params?: unknown }

type Held = {
  session: string
  send: (frame: string) => void
  end: () => void
}

let body = (told: Told) =>
  JSON.stringify({
    jsonrpc: '2.0',
    method: told.method,
    ...(told.params ? { params: told.params } : {}),
  })

// One SSE frame, with its id: the id is the cursor a reconnect resumes from,
// so it rides on every line the log keeps.
let framed = (id: number, told: Told) => `id: ${id}\ndata: ${body(told)}\n\n`

// And one with none, for what is said to a single stream and never logged
// (`crossed` below): a frame without an id leaves the cursor where it was.
let bare = (told: Told) => `data: ${body(told)}\n\n`

// The lists a platform release moves, in the release news `crossed` says.
let LISTS = ['tools', 'resources', 'prompts']

// How many sessions' last-spoken-for version the object keeps: a person's
// clients are few, and a session evicted early only hears one release's news
// a second time.
let KEPT = 64

export class Wire {
  state: State
  // The release marker a resumed stream compares (T-33013): Cloudflare's
  // per-deploy version id, which the runtime mints fresh on every `wrangler
  // deploy` — so a deploy moves it with no file edit, which is the point. The
  // binding is absent under `wrangler dev` and the workerd probes, so it falls
  // back to the human VERSION there (which those never move either, so the
  // fallback stays quiet across their restarts).
  mark: string
  // The streams open RIGHT NOW, oldest first. This is the only thing here
  // that does not survive the object being evicted — which is what the log
  // in storage is for.
  open = new Set<Held>()
  beat: ReturnType<typeof setInterval> | undefined
  // The log, read from storage once and held while the object lives.
  news: News | undefined

  constructor(state: State, env: { CF_VERSION_METADATA?: { id?: string } }) {
    this.state = state
    this.mark = env?.CF_VERSION_METADATA?.id ?? VERSION
  }

  async log(): Promise<News> {
    return this.news ??= await this.state.storage.get<News>('news') ??
      { seq: 0, lines: [] }
  }

  // The keepalive, one per object and only while someone is listening.
  warm() {
    if (this.beat != null) return
    this.beat = setInterval(() => {
      if (!this.open.size) return this.cool()
      for (let held of this.open) held.send(': beat\n\n')
    }, BEAT)
  }

  cool() {
    if (this.beat == null) return
    clearInterval(this.beat)
    this.beat = undefined
  }

  drop(held: Held) {
    if (!this.open.delete(held)) return
    held.end()
    if (!this.open.size) this.cool()
  }

  // A platform release replaces the Worker, restarts this object and drops
  // every open stream; the client resumes with `Last-Event-ID` and nothing
  // in that tells it the platform's OWN tools, resources, prompts and guide
  // pages moved with the release (T-33005). So the object remembers, per
  // session, the deploy `mark` it last spoke for: a stream attaching for a
  // session last spoken to under another release hears that all three lists
  // moved — said to this stream alone, without ids and off the log, so no
  // cursor moves and no other session hears a copy, keeping the transport's
  // one-copy-per-session rule. A session never seen is a client that just
  // initialized and listed fresh, so it is remembered silently — and the
  // nameless session is one key like any other, the best that can be done
  // for clients that cannot be told apart. The newest KEPT sessions are
  // what the map holds.
  async crossed(held: Held) {
    let spoke = await this.state.storage.get<Record<string, string>>(
      'spoke',
    ) ?? {}
    let was = spoke[held.session]
    if (was == this.mark) return
    if (was != null) {
      for (let list of LISTS) {
        held.send(bare({ method: `notifications/${list}/list_changed` }))
      }
    }
    delete spoke[held.session]
    spoke[held.session] = this.mark
    for (let old of Object.keys(spoke).slice(0, -KEPT)) delete spoke[old]
    await this.state.storage.put('spoke', spoke)
  }

  // A client attaching its stream: what it missed, then the line stays open.
  // `Last-Event-ID` is the last id it saw; absent, it has seen nothing and is
  // handed nothing, because a client that never listened lists its tools at
  // connect anyway.
  async attach(req: Request): Promise<Response> {
    let session = req.headers.get('mcp-session-id') ?? ''
    // No `Last-Event-ID` is a client that has seen nothing, not one asking
    // from the top: it lists its tools at connect, so the log is not its
    // business. `Number('')` is 0, which is why this is not one expression.
    let last = req.headers.get('last-event-id')
    let since = last ? Number(last) : NaN
    let { readable, writable } = new TransformStream()
    let bytes = new TextEncoder()
    let out = writable.getWriter()
    // Writes are serialized through one chain: a writer takes one write at a
    // time, and the first failure is the client having let go.
    let tail = Promise.resolve()
    let held: Held = {
      session,
      send: (frame) => {
        tail = tail
          .then(() => out.write(bytes.encode(frame)))
          .catch(() => this.drop(held))
      },
      end: () => void out.close().catch(() => {}),
    }
    this.open.add(held)
    this.warm()
    // A comment frame is nothing to a client and proof to the one holding it
    // that the stream is live.
    held.send(': open\n\n')
    if (Number.isFinite(since)) {
      for (let line of (await this.log()).lines) {
        if (line.id > since) held.send(line.frame)
      }
    }
    await this.crossed(held)
    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      },
    })
  }

  // One JSON-RPC notification: onto the log, then out to whoever is here. A
  // notification has no id and takes no reply, so nothing waits on delivery —
  // the log is what makes it arrive anyway.
  async tell(told: Told): Promise<Response> {
    let news = await this.log()
    let id = ++news.seq
    news.lines.push({ id, frame: framed(id, told) })
    news.lines.splice(0, news.lines.length - DEEP)
    await this.state.storage.put('news', news)
    let frame = news.lines[news.lines.length - 1].frame
    let sent = new Set<string>()
    // Newest stream first, so a session that reconnected hears on the
    // connection it is actually holding.
    for (let held of [...this.open].reverse()) {
      if (held.session && sent.has(held.session)) continue
      if (held.session) sent.add(held.session)
      held.send(frame)
    }
    return Response.json({ id })
  }

  async fetch(req: Request): Promise<Response> {
    let path = new URL(req.url).pathname
    if (path == '/open') return this.attach(req)
    if (path == '/tell') return this.tell(await req.json() as Told)
    return new Response('not found', { status: 404 })
  }
}

// The person's own object. The kernel spells the name and it is the person's
// eid, never anything a client says: who is asking was settled by identity.ts
// before anything here is reached, and a session id only picks a stream
// WITHIN the person it already belongs to.
let wireOf = (ns: Namespace, person: string): Stub =>
  ns.get(ns.idFromName(person))

// The GET's answer: this person's stream, resumed where the client says it
// left off.
export let listen = (env: Env, person: string, req: Request) =>
  wireOf(env.WIRE, person).fetch(
    new Request('http://wire/open', {
      headers: Object.fromEntries(
        ['mcp-session-id', 'last-event-id']
          .map((h) => [h, req.headers.get(h)])
          .filter(([, v]) => v) as [string, string][],
      ),
    }),
  )

// News for one person, whether or not they are listening this second.
export let told = async (
  env: Env,
  person: string,
  method: string,
  params?: unknown,
) => {
  let r = await wireOf(env.WIRE, person).fetch(
    new Request('http://wire/tell', {
      method: 'POST',
      body: JSON.stringify({ method, params }),
    }),
  )
  await r.body?.cancel()
}
