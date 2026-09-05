// The Store Durable Object: one SQLite graph per (space, app) — db.ts's
// apply() and query grammar over the DO adapter (src/store/do.ts), planted
// from the generated schema ops on first touch and never migrated. It serves
// the two HTTP doors src/server_runtime.ts serves for headless clients, with
// the same request and response bodies: POST /apply — which also answers
// `?check=1`, admission without a commit, the gate a write that spans two
// stores passes first (reach.ts) — and GET /query, plus GET
// /graph, the identity a joining peer reads, and /vocab, the app's own
// components (store/vocab.ts) that app_deploy plants here and the object wakes
// with, /tools, the app's own MCP tools (store/tools.ts) that the same deploy
// hands over and the agent door lists, and DELETE /, which empties the object
// when app_delete throws its app away. One flag beyond the wire:
// `x-yak-kernel`, set by the kernel on its own requests and never forwarded
// from a client, opens apply()'s server-writer mode, so what a route threw
// lands as a server-owned exception entity through the same door (D-32318
// §Errors) — no second shape, no SQL outside db.ts. The object is named
// `<space>/<app>` by the kernel's route (index.ts), never by a client, and
// learns that name from the first request.
//
// GET /ws is the third door and the live one: a page's socket onto this app's
// graph, so a write from one device shows up on another. The serving half is
// subserve.ts's — the very module the Deno server and its per-connection
// workers hold — so a frame means here exactly what it means there: `{since}`
// catches a returning socket up, `{sub}`/`{unsub}` open and close
// subscriptions, an array frame is a write batch, and every committed apply
// (through this door or /apply) casts to every socket. The sockets are
// HIBERNATABLE: the runtime holds them while this object is evicted, so an
// idle tab costs nothing, and what a socket declared lives ON the socket
// (its attachment) because this object's memory does not survive that.
//
// What a socket HEARS is the /query door's own answer, though: a subscription
// is that query still answering, so each frame's changes are re-read as the
// rows /query would hand back (query.ts `answered`) rather than shipped as the
// wire's raw patches. One projection, two doors — a page that swaps `query()`
// for `subscribe()` changes nothing else (C-32624 item 2).
//
// Not here yet, deliberately: the journal feed that fires effects, `work=`
// lanes and `.order=similar` (both reach outside the store) — see query.ts.
import {
  correct,
  cursorOf,
  epochOf,
  graft,
  locate,
  mutate,
  plant,
  plantVocab,
  regraft,
  type SchemaOp,
  schemaStamp,
  vocabHash,
} from '../../src/db.ts'
import { fed } from '../../src/effects.ts'
import { type Mutation, mutationResult } from '../../src/mutation.ts'
import { DoSql, type DoStorage } from '../../src/store/do.ts'
import { parseTools, type Tools, viewsOf } from '../../src/store/tools.ts'
import {
  borrowed,
  countSql,
  dropOps,
  grow,
  parseVocab,
  type Vocab,
} from '../../src/store/vocab.ts'
import ops from '../../src/store/schema.json' with { type: 'json' }
import { type Frame, type Subserve, subserve } from '../../src/subserve.ts'
import type { Change } from '../../src/types.ts'
import { asking } from './listing.ts'
import { answered, query } from './query.ts'

// The slice of the Durable Object runtime this Worker touches, structurally,
// so `deno check` reads it without @cloudflare/workers-types. A hibernatable
// socket carries an ATTACHMENT — the only per-socket state that survives the
// object being evicted between two frames.
type Sock = WebSocket & {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}
type Ctx = {
  // `deleteAll` is the ONE way to empty an object: dropping the tables leaves
  // metadata behind, and an object whose storage is empty ceases to exist.
  // `databaseSize` is how many bytes this object holds — the only per-app
  // storage figure that exists, since Cloudflare's storage dataset has no
  // per-object dimension, so the usage sweep reads it through /graph.
  storage: DoStorage & {
    deleteAll(): Promise<void>
    sql: { databaseSize: number }
  }
  acceptWebSocket(ws: WebSocket): void
  getWebSockets(): Sock[]
}
declare let WebSocketPair: { new (): { 0: Sock; 1: Sock } }
export type Stub = { fetch(req: Request): Promise<Response> }
export type Namespace = {
  idFromName(name: string): unknown
  get(id: unknown): Stub
}

// What a socket declared, held on the socket itself: whether the kernel
// vouched for a writer at the handshake, who it writes as, its `{since}`
// join and its subscriptions by name. A woken object rebuilds the serving
// half from these and nothing else. The runtime caps an attachment at 2KB —
// a few subscriptions, and a socket that wants more is told so rather than
// quietly losing one at the next hibernation.
type Held = {
  write: boolean
  via: string | null
  title?: string | null
  join?: Record<string, unknown>
  subs: Record<string, Record<string, unknown>>
}
let HELD = 2048

let why = (e: unknown) => e instanceof Error ? e.message : String(e)

// The schema this Worker carries, as one word (db.ts schemaStamp): what a
// store stamps itself with when it is raised, and what a wake compares
// against. Once per isolate, since the ops never move under it.
let stamp = schemaStamp(ops as SchemaOp[])

// The throw that unwinds a `?check=1` write, thrown and caught in one place
// so nothing else can be mistaken for it.
let UNDO = new Error('checked')

// Who the kernel says is writing. Attribution is an honesty header, not auth:
// `x-via` names an instrument that named itself, while `x-yak-person` is the
// kernel's own word about the session it verified — and neither reaches this
// object except from the kernel, which builds its requests from scratch.
let writerOf = (req: Request) =>
  req.headers.get('x-via') ?? req.headers.get('x-yak-person')

// What to call that writer, in this store. It rides only beside the kernel's
// word about a person: an instrument that named itself (`x-via`) is not a
// person and never wears a person's name.
let titleOf = (req: Request) =>
  req.headers.get('x-via') ? null : req.headers.get('x-yak-title')

let methodNotAllowed = (allow: string) =>
  Response.json({ error: { code: 'method_not_allowed' } }, {
    status: 405,
    headers: { allow },
  })

export class Store {
  db: DoSql
  name: string
  ctx: Ctx
  // The serving halves of the sockets open right now, for THIS incarnation of
  // the object. A hibernated socket has none until its next frame rebuilds it.
  socks = new Map<WebSocket, Subserve>()

  constructor(ctx: Ctx, _env: unknown) {
    this.ctx = ctx
    this.db = new DoSql(ctx.storage)
    this.name = String(ctx.storage.kv.get('name') ?? '')
    this.born()
  }

  // Waking on this storage, whatever is in it. First touch plants the whole
  // schema in one transaction. A store planted under an OLDER schema grows
  // into this one instead (db.ts regraft): every generated op is a guarded
  // create-if-absent or add-column, so replaying them adds what a new
  // component brought and leaves what is there alone — and every definition,
  // which no replay can alter, is dropped and raised again at the current
  // shape, because half of an older schema and half of this one compile into
  // a broken statement (T-32826). The schema's own fingerprint says when that
  // is worth doing, so a wake under the same schema costs nothing. Nobody
  // hand-migrates a Durable Object; this is the only door a column has.
  // Emptying the object (`DELETE /`) is a second birth on the same handle,
  // which is why this is not written inline above.
  born() {
    let held = String(this.db.kv.get('schema') ?? '')
    if (!this.db.version) plant(this.db, ops as SchemaOp[])
    else if (held != stamp) regraft(this.db, ops as SchemaOp[])
    if (held != stamp) this.db.kv.put('schema', stamp)
    // The app's own components (vocab.json, T-32502) are storage the object
    // wakes with: the manifest it last accepted is replayed into this handle
    // so apply(), the query grammar and the graph-out projection speak the
    // app's words again. The tables are already there — planting is what the
    // /vocab door did — so this is the word, not the DDL. Empty is meaningful:
    // a store that has a vocabulary door says so, and its refusals teach.
    plantVocab(this.db, this.vocab())
  }

  // What this store last accepted, as written. Junk in the slot is nothing:
  // the object must wake even if a manifest it once stored no longer parses.
  vocab(): Vocab {
    try {
      return parseVocab(JSON.parse(String(this.db.kv.get('vocab') ?? '{}')))
    } catch {
      return {}
    }
  }

  // The words this app USES but does not home (T-32728): one word, one home,
  // so a word another app in the space already declares is not planted here
  // — it is recorded here, naming where it lives. Nothing is grafted for it:
  // its table is the home's, and its rows go there (reach.ts routes them).
  // A list, because where the word lives is the whole of what this store has
  // to know; its columns are the home's to say.
  uses(): Record<string, string> {
    try {
      let held = JSON.parse(String(this.db.kv.get('uses') ?? '{}'))
      return held && typeof held == 'object' && !Array.isArray(held)
        ? Object.fromEntries(
          Object.entries(held as Record<string, unknown>)
            .filter(([, at]) => typeof at == 'string'),
        ) as Record<string, string>
        : {}
    } catch {
      return {}
    }
  }

  // The tools this app declares (tools.json, T-32685), kept beside the
  // vocabulary because they are the same kind of thing: words this store
  // says that no other store does. Nothing is planted for them — a tool is a
  // template over the doors this store already has — so this slot is read at
  // the MCP door and written by a deploy, and junk in it is nothing.
  //
  // A tool may name a word this app USES as well as one it homes: the word
  // is the app's to write either way, and the door sends it to the home
  // store. The columns are the home's, so the use enters the check as a bare
  // name.
  tools(): Tools {
    try {
      return parseTools(
        JSON.parse(String(this.db.kv.get('tools') ?? '{}')),
        { ...this.vocab(), ...borrowed(this.uses()) },
      )
    } catch {
      return {}
    }
  }

  // What one of this store's own components holds, for the drop rule above.
  // A word that was declared but whose table never landed holds nothing —
  // which is exactly the case that lets it go.
  rows(name: string): number {
    try {
      return Number(
        (this.db.prepare(countSql(name)).get() as { n: number }).n,
      )
    } catch {
      return 0
    }
  }

  // The filter line one frame answers — the query that subscription declared,
  // read back off the socket, since the answer's shape is the filter's own
  // (a stamp named in the line is a stamp the answer carries).
  asked(ws: Sock, f: Frame): string {
    let name = !Array.isArray(f) && typeof f.sub == 'string' ? f.sub : ''
    return String(this.held(ws).subs[name]?.q ?? '')
  }

  // What one socket declared, read back off it.
  held(ws: Sock): Held {
    return (ws.deserializeAttachment() as Held | null) ??
      { write: false, via: null, subs: {} }
  }

  // This socket's serving half, rebuilt from its attachment when the object
  // was evicted since the last frame. The replay is MUTE: it re-seeds the
  // subscriptions' member sets, and the client already holds the frames those
  // declarations answered with the first time.
  serving(ws: Sock): Subserve {
    let live = this.socks.get(ws)
    if (live) return live
    let quiet = true
    // Every frame leaves through the /query door's own projection (query.ts
    // `answered`), so "query that keeps answering" is one answer and not two
    // shapes of one (C-32624 item 2). The filter line it is answered against is
    // the one the socket declared, held on the socket.
    let sub = subserve(this.db, (frame) => {
      if (!quiet) {
        ws.send(JSON.stringify(answered(this.db, frame, this.asked(ws, frame))))
      }
    })
    let held = this.held(ws)
    // Rejoining the live stream at the CURRENT cursor: the catch-up a held
    // `{since}` would replay is muted anyway, so this reads no journal and
    // builds no working set — it restores the stream, nothing else.
    if (held.join) {
      sub.frame({
        ...held.join,
        since: cursorOf(this.db),
        epoch: epochOf(this.db),
        vocab: vocabHash,
      })
    }
    for (let f of Object.values(held.subs)) sub.frame(f)
    quiet = false
    this.socks.set(ws, sub)
    return sub
  }

  // A control frame is also a DECLARATION: remember it on the socket, so a
  // tab the runtime hibernated wakes serving the same subscriptions.
  declared(ws: Sock, f: Record<string, unknown>) {
    let held = this.held(ws)
    if ('since' in f) held.join = f
    else if (typeof f.unsub == 'string') delete held.subs[f.unsub]
    else if (typeof f.sub == 'string') held.subs[f.sub] = f
    else return
    if (JSON.stringify(held).length > HELD) {
      throw new Error('too many subscriptions on one socket')
    }
    ws.serializeAttachment(held)
  }

  // Every committed batch, to every socket — the one door a write on one
  // device arrives on another through, whichever door the write came in.
  cast(changes: Change[]) {
    let socks = this.ctx.getWebSockets()
    if (!socks.length) return
    let cursor = cursorOf(this.db)
    for (let ws of socks) {
      // A socket closing mid-cast loses a frame; it is not the batch's
      // problem, and the reconnect catches that client up.
      try {
        this.serving(ws).cast(changes, cursor)
      } catch (e) {
        console.warn('store: cast', why(e))
      }
    }
  }

  // Who a write acts as, known to THIS store. `created.by` resolves the
  // writer against the store's own rows (db.ts actorFor), and an app's store
  // has never heard of anyone: the directory keeps the person rows, one graph
  // over. So the person the kernel vouched for is minted here the first time
  // they write, and every row they save after that says who saved it
  // (T-32534). Its own write is not cast: a person is not app data, and no
  // page subscribes to one.
  //
  // And they are minted with a NAME: an eid signs nothing a reader can tell
  // apart, so two people on one page were one uuid and another (C-32624 item
  // 3). The kernel sends what to call them — their address today, a display
  // name when the platform learns one — and the row wears it as `doc.title`,
  // which a page reads like any other title. Their `email` stays in the
  // directory: an app's store learns a name, never an address book. The title
  // is written on every write it rides with, so a row minted before the
  // platform knew any name heals on the next one and a changed address
  // follows; a write that changes nothing IS nothing (db.ts settled), so
  // saying the same name again costs a read.
  knows(who: string | null, title: string | null) {
    if (!who) return who
    let fresh = !locate(this.db, who)
    if (fresh || title) {
      mutate(
        this.db,
        [
          ...(fresh ? [{ eid: who, name: 'person', comp: {} }] : []),
          ...(title ? [{ eid: who, name: 'doc', comp: { title } }] : []),
        ],
        fed(),
        who,
      )
    }
    return who
  }

  // The same write, ADMITTED and then undone: every refusal a commit would
  // make — an unknown column, a dead entity, a `was` that moved — raised
  // here, with nothing left behind. It is the first half of a write that
  // SPANS stores (reach.ts): a bundle split between two apps is admitted in
  // both before either commits, so a refusal in one leaves the other
  // unwritten. Rolling back is the seam's own door (store/sql.ts): the
  // callback throws, the transaction unwinds, and the throw is ours to
  // recognize. Nothing is cast — nothing happened.
  check(
    mutation: Mutation,
    via: string | null,
    title: string | null,
    kernel: boolean,
  ) {
    try {
      this.db.transaction(() => {
        mutate(this.db, mutation, fed(), this.knows(via, title), kernel)
        throw UNDO
      })
    } catch (e) {
      if (e != UNDO) throw e
    }
  }

  // One write: applied, then broadcast. The doors differ, the commit does not.
  commit(
    mutation: Mutation,
    via: string | null,
    title: string | null,
    kernel: boolean,
  ) {
    let out = mutationResult(
      mutate(this.db, mutation, fed(), this.knows(via, title), kernel),
    )
    this.cast(out.changes)
    return out
  }

  // A write batch off a socket. Only a socket the kernel vouched for at the
  // handshake writes; a refusal names the rows the sender applied optimistically
  // (db.ts correct()), the same reject frame the Deno server sends.
  wrote(ws: Sock, changes: Change[], id?: string) {
    let held = this.held(ws)
    if (!held.write) {
      return ws.send(JSON.stringify({ error: 'not_a_writer', id }))
    }
    try {
      this.commit(changes, held.via, held.title ?? null, false)
      if (id) ws.send(JSON.stringify({ ack: id }))
    } catch (e) {
      ws.send(JSON.stringify({
        error: why(e),
        changes: correct(this.db, changes),
        id,
      }))
    }
  }

  webSocketMessage(ws: Sock, message: string | ArrayBuffer) {
    try {
      let f = JSON.parse(
        typeof message == 'string'
          ? message
          : new TextDecoder().decode(message),
      )
      // Array frames are write batches, object frames control — the same
      // structurally disjoint split the Deno server's /ws makes.
      if (Array.isArray(f)) return this.wrote(ws, f as Change[])
      if (Array.isArray(f.apply)) {
        return this.wrote(ws, f.apply, f.id != null ? String(f.id) : undefined)
      }
      // A page's subscription is a page's question, so it carries the same
      // screen the /query door asks with (listing.ts `asking`): one filter
      // answers one way, over a socket or over a fetch.
      if (typeof f.q == 'string') f.q = asking(f.q)
      this.declared(ws, f)
      this.serving(ws).frame(f)
    } catch (e) {
      ws.send(JSON.stringify({ error: why(e) }))
    }
  }

  webSocketClose(ws: Sock, code: number, reason: string) {
    this.socks.delete(ws)
    // Complete the closing handshake from this end; 1006 is never sendable.
    try {
      ws.close(code == 1006 ? 1000 : code, reason)
    } catch { /* already gone */ }
  }

  webSocketError(ws: Sock) {
    this.socks.delete(ws)
  }

  async fetch(req: Request): Promise<Response> {
    let url = new URL(req.url)
    let path = url.pathname
    let db = this.db
    // The object learns its own name from the first request that reaches it.
    if (!this.name) {
      this.name = req.headers.get('x-store') ?? ''
      this.db.kv.put('name', this.name)
    }
    // The app this store held is gone (app_delete): everything in it, at
    // once. `deleteAll` is the only way to empty an object — dropping tables
    // leaves metadata, and an object with empty storage ceases to exist — but
    // THIS incarnation stays in memory with a handle onto nothing, so it is
    // born again on the spot: an app made later at the same address finds a
    // planted, empty graph rather than one with no tables at all. Kernel
    // only, like the writer flag: a client's request never carries it.
    if (path == '/' && req.method == 'DELETE') {
      if (req.headers.get('x-yak-kernel') != '1') {
        return new Response('not found', { status: 404 })
      }
      // The pages watching this app are watching nothing now.
      for (let ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'deleted')
        } catch { /* already gone */ }
      }
      this.socks.clear()
      await this.ctx.storage.deleteAll()
      this.born()
      // Its name went with the rest; the object still answers to it.
      this.db.kv.put('name', this.name)
      return Response.json({ ok: true })
    }
    if (path == '/graph') {
      return Response.json({
        db: `do:${this.name}`,
        epoch: epochOf(db),
        pid: 0,
        // What this store weighs, right now. The hourly sweep reads it for
        // the app's meter, and the byte ceiling reads it again when a space
        // is close enough that an hour of writes could matter (usage.ts).
        bytes: this.ctx.storage.sql.databaseSize,
      })
    }
    // The app's own vocabulary: the manifest app_deploy read out of the app's
    // files. Planting is ADDITIVE and idempotent — a deploy that changed
    // nothing re-plants nothing, a deploy that added a column adds it, and a
    // column this store already has is never dropped or retyped, because its
    // rows are already written. The kernel is the only caller.
    //
    // The one thing that leaves: a component this manifest stopped naming and
    // that holds no rows — the table goes with the word, so a name tried once
    // and abandoned is not declared forever (C-32624 item 1). The whole
    // manifest is read and refused before any of it is planted, so a refusal
    // leaves the store exactly as it was.
    //
    // The answer says what moved — `added` and `kept` beside `dropped` — so a
    // renamed column is visible to whoever deployed it (C-32652 item 4).
    if (path == '/vocab') {
      // A GET reads back what this store last accepted — the words that are
      // this app's own, which is how the door knows whose a component is when
      // it routes a write across apps (reach.ts, T-32700).
      if (req.method == 'GET') return Response.json(this.vocab())
      if (req.method != 'POST') return methodNotAllowed('GET, POST')
      try {
        let { vocab, dropped, added, kept } = grow(
          this.vocab(),
          parseVocab(await req.text()),
          (name) => this.rows(name),
        )
        if (dropped.length) graft(db, dropOps(dropped))
        plantVocab(db, vocab)
        db.kv.put('vocab', JSON.stringify(vocab))
        return Response.json({
          ok: true,
          comps: Object.keys(vocab),
          dropped,
          added,
          kept,
        })
      } catch (e) {
        let why = e instanceof Error ? e.message : String(e)
        return new Response(why, { status: 400 })
      }
    }
    // The words this app USES but does not home (T-32728). One word, one
    // home: a word another app in the space already declares is recorded
    // here and planted there, so nothing is grafted and no table is made.
    // The deploy is the only caller — it is the one that can read the other
    // apps' manifests and say where a word lives.
    if (path == '/uses') {
      if (req.method == 'GET') return Response.json(this.uses())
      if (req.method != 'POST') return methodNotAllowed('GET, POST')
      try {
        let sent = JSON.parse(await req.text())
        db.kv.put('uses', JSON.stringify(sent))
        return Response.json({ ok: true, uses: Object.keys(this.uses()) })
      } catch (e) {
        return new Response(why(e), { status: 400 })
      }
    }
    // The app's own MCP tools (tools.json, T-32685): the manifest app_deploy
    // read out of the app's files, checked against THIS store's vocabulary —
    // a tool writing a component nobody declared is refused here, where the
    // words are. It is replaced whole, since a declaration holds no rows: an
    // app that deletes its tools.json deploys an empty manifest and its tools
    // are gone. The answer says whether the words MOVED — the tools and the
    // views each for themselves — which is what tells the door to say
    // `tools/list_changed` and `resources/list_changed` (T-32686, T-33004).
    // The kernel is the only caller; a GET reads back what this store last
    // accepted.
    if (path == '/tools') {
      if (req.method == 'GET') return Response.json(this.tools())
      if (req.method != 'POST') return methodNotAllowed('GET, POST')
      try {
        let sent = parseTools(await req.text(), {
          ...this.vocab(),
          ...borrowed(this.uses()),
        })
        let now = JSON.stringify(sent)
        let was = String(db.kv.get('tools') ?? '{}')
        // The manifest's two halves, compared apart (T-33004): the TOOL half
        // is the manifest views aside — what tools/list is made of — and the
        // VIEW half is the set of pages the tools name — what resources/list
        // is made of. A release that only repointed or grew a view moves
        // resources and not tools, and the door says each with its own
        // list_changed.
        let bare = (t: Tools) =>
          JSON.stringify(
            Object.entries(t).map(([n, d]) => [n, { ...d, view: undefined }]),
          )
        let changed = bare(sent) != bare(JSON.parse(was) as Tools)
        let views = viewsOf(now).sort().join('\n') !=
          viewsOf(was).sort().join('\n')
        if (changed || views) db.kv.put('tools', now)
        return Response.json({
          ok: true,
          tools: Object.keys(sent),
          changed,
          views,
        })
      } catch (e) {
        return new Response(why(e), { status: 400 })
      }
    }
    if (path == '/ws') {
      if (req.headers.get('upgrade') != 'websocket') {
        return new Response('expected a websocket upgrade', { status: 426 })
      }
      let pair = new WebSocketPair()
      // Accepted for HIBERNATION: the runtime holds this socket while the
      // object is evicted and wakes it with the next frame, so an idle tab
      // costs nothing. Whether it may write is the kernel's word at the
      // handshake, never a frame's claim.
      this.ctx.acceptWebSocket(pair[1])
      pair[1].serializeAttachment(
        {
          write: req.headers.get('x-yak-write') == '1',
          via: writerOf(req),
          title: titleOf(req),
          subs: {},
        } satisfies Held,
      )
      // The 101 carries the other end of the pair; Deno's ResponseInit has no
      // `webSocket`, so the runtime's own shape is named here.
      return new Response(
        null,
        { status: 101, webSocket: pair[0] } as ResponseInit,
      )
    }
    if (path == '/query') {
      if (req.method != 'GET') return methodNotAllowed('GET')
      try {
        return Response.json(await query(db, url.search))
      } catch (e) {
        return new Response(String((e as Error).message ?? e), { status: 400 })
      }
    }
    if (path == '/apply') {
      if (req.method != 'POST') return methodNotAllowed('POST')
      try {
        let mutation = await req.json() as Mutation
        // `?check=1` asks only whether this batch would be ADMITTED, and
        // commits nothing (`check` above). It is the kernel's by
        // construction: a client never spells a store's path, and the door
        // that serves a page builds this request itself, without a query
        // string.
        if (url.searchParams.get('check') == '1') {
          this.check(
            mutation,
            writerOf(req),
            titleOf(req),
            req.headers.get('x-yak-kernel') == '1',
          )
          return Response.json({ ok: true, checked: true })
        }
        // Attribution is an honesty header, not auth: x-via names the
        // instrument, apply resolves it to the actor it acts for. The trace
        // is fed so the journal row is the one a server writes; the feed
        // that fires effects off it is still to come. The commit casts to
        // every open socket on its way out, so a headless write is a live
        // one on every device watching.
        let out = this.commit(
          mutation,
          writerOf(req),
          titleOf(req),
          req.headers.get('x-yak-kernel') == '1',
        )
        return Response.json(
          !Array.isArray(mutation) && 'entities' in mutation
            ? { ok: true, ...out }
            : { ok: true, changes: out.changes },
        )
      } catch (e) {
        // The MESSAGE, not String(e): a rejection is read by a person or an
        // agent, and String(new Error(x)) prefixes a stray "Error:".
        let why = e instanceof Error ? e.message : String(e)
        return new Response(why, { status: 400 })
      }
    }
    return new Response('not found', { status: 404 })
  }
}

// The kernel's door to one store: a caller on the object named for the app
// (directory.ts storeName — the address it was born at, which a rename never
// moves), told its name on every call (the object keeps the first). The
// kernel spells the name; a client never names a store. An incoming Request
// may BE the init: that is how a socket upgrade reaches the object with its
// `Upgrade` header on it, since the header a route adds rides beside it.
export type Door = (
  path: string,
  init?: RequestInit | Request,
  headers?: Record<string, string>,
) => Promise<Response>

// The statement only the kernel may make, and therefore the set every request
// to a store is scrubbed of before the kernel makes it. An init that IS a
// Request carries its headers across — that is how a socket upgrade reaches
// the object with its `Upgrade` header on it — so a visitor's own
// `x-yak-person` would ride along with it and the object would believe it
// (store.ts `writerOf`, graph.ts `vouchOf`). Stripped here, at the one door
// onto a store, "the kernel builds every request from scratch" is a fact
// about this function rather than a hope about its callers.
let VOUCH = [
  'x-store',
  'x-yak-app',
  'x-yak-access',
  'x-yak-person',
  'x-yak-role',
  'x-yak-title',
  'x-yak-write',
  'x-yak-kernel',
  'x-via',
]

/** Which app this door serves, as the directory has it: the entity the
 * @yaks/member guard asks about, and the access mode that is the last word on
 * a caller holding no level. The store remembers both (graph.ts `#learn`), so
 * a door that cannot name its app simply says nothing about it. */
export type Served = { eid: string; access: string | null }

export let storeOf = (ns: Namespace, name: string, app?: Served): Door => {
  let stub = ns.get(ns.idFromName(name))
  return (path, init = {}, headers = {}) => {
    let req = new Request(`http://store${path}`, init)
    for (let h of VOUCH) req.headers.delete(h)
    for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
    req.headers.set('x-store', name)
    if (app) {
      req.headers.set('x-yak-app', app.eid)
      if (app.access) req.headers.set('x-yak-access', app.access)
    }
    return stub.fetch(req)
  }
}
