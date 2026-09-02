// The Store Durable Object: one SQLite graph per (space, app) — db.ts's
// apply() and query grammar over the DO adapter (src/store/do.ts), planted
// from the generated schema ops on first touch and never migrated. It serves
// the two HTTP doors src/server_runtime.ts serves for headless clients, with
// the same request and response bodies: POST /apply and GET /query, plus GET
// /graph, the identity a joining peer reads, and POST /vocab, the app's own
// components (store/vocab.ts) that app_deploy plants here and the object wakes
// with, and DELETE /, which empties the object when app_delete throws its app
// away. One flag beyond the wire:
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
  type SchemaOp,
  vocabHash,
} from '../../src/db.ts'
import { fed } from '../../src/effects.ts'
import { type Mutation, mutationResult } from '../../src/mutation.ts'
import { DoSql, type DoStorage } from '../../src/store/do.ts'
import { grow, parseVocab, type Vocab } from '../../src/store/vocab.ts'
import ops from '../../src/store/schema.json' with { type: 'json' }
import { type Subserve, subserve } from '../../src/subserve.ts'
import type { Change } from '../../src/types.ts'
import { query } from './query.ts'

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
  storage: DoStorage & { deleteAll(): Promise<void> }
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
  join?: Record<string, unknown>
  subs: Record<string, Record<string, unknown>>
}
let HELD = 2048

let why = (e: unknown) => e instanceof Error ? e.message : String(e)

// Who the kernel says is writing. Attribution is an honesty header, not auth:
// `x-via` names an instrument that named itself, while `x-yak-person` is the
// kernel's own word about the session it verified — and neither reaches this
// object except from the kernel, which builds its requests from scratch.
let writerOf = (req: Request) =>
  req.headers.get('x-via') ?? req.headers.get('x-yak-person')

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
  // schema in one transaction. A store planted under an OLDER vocabulary
  // grows into this one instead: every generated op is a guarded
  // create-if-absent or add-column, so replaying them adds what a new
  // component brought and leaves what is there alone. The vocabulary's own
  // fingerprint says when that is worth doing, so a wake under the same words
  // costs nothing. Nobody hand-migrates a Durable Object; this is the only
  // door a column has. Emptying the object (`DELETE /`) is a second birth on
  // the same handle, which is why this is not written inline above.
  born() {
    let held = String(this.db.kv.get('vocab_hash') ?? '')
    if (!this.db.version) plant(this.db, ops as SchemaOp[])
    else if (held != vocabHash) graft(this.db, ops as SchemaOp[])
    if (held != vocabHash) this.db.kv.put('vocab_hash', vocabHash)
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
    let sub = subserve(this.db, (json) => {
      if (!quiet) ws.send(json)
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
  knows(who: string | null) {
    if (who && !locate(this.db, who)) {
      mutate(this.db, [{ eid: who, name: 'person', comp: {} }], fed(), who)
    }
    return who
  }

  // One write: applied, then broadcast. The doors differ, the commit does not.
  commit(mutation: Mutation, via: string | null, kernel: boolean) {
    let out = mutationResult(
      mutate(this.db, mutation, fed(), this.knows(via), kernel),
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
      this.commit(changes, held.via, false)
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
      })
    }
    // The app's own vocabulary: the manifest app_deploy read out of the app's
    // files. Planting is ADDITIVE and idempotent — a deploy that changed
    // nothing re-plants nothing, a deploy that added a column adds it, and a
    // column this store already has is never dropped or retyped, because its
    // rows are already written. The kernel is the only caller.
    if (path == '/vocab') {
      if (req.method != 'POST') return methodNotAllowed('POST')
      try {
        let grown = grow(this.vocab(), parseVocab(await req.text()))
        plantVocab(db, grown)
        db.kv.put('vocab', JSON.stringify(grown))
        return Response.json({ ok: true, comps: Object.keys(grown) })
      } catch (e) {
        let why = e instanceof Error ? e.message : String(e)
        return new Response(why, { status: 400 })
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
        // Attribution is an honesty header, not auth: x-via names the
        // instrument, apply resolves it to the actor it acts for. The trace
        // is fed so the journal row is the one a server writes; the feed
        // that fires effects off it is still to come. The commit casts to
        // every open socket on its way out, so a headless write is a live
        // one on every device watching.
        let out = this.commit(
          mutation,
          writerOf(req),
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

export let storeOf = (ns: Namespace, name: string): Door => {
  let stub = ns.get(ns.idFromName(name))
  return (path, init = {}, headers = {}) => {
    let req = new Request(`http://store${path}`, init)
    for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
    req.headers.set('x-store', name)
    return stub.fetch(req)
  }
}
