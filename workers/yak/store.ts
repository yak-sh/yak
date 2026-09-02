// The Store Durable Object: one SQLite graph per (space, app) — db.ts's
// apply() and query grammar over the DO adapter (src/store/do.ts), planted
// from the generated schema ops on first touch and never migrated. It serves
// the two HTTP doors src/server_runtime.ts serves for headless clients, with
// the same request and response bodies: POST /apply and GET /query, plus GET
// /graph, the identity a joining peer reads, and POST /vocab, the app's own
// components (store/vocab.ts) that app_deploy plants here and the object wakes
// with. One flag beyond the wire:
// `x-yak-kernel`, set by the kernel on its own requests and never forwarded
// from a client, opens apply()'s server-writer mode, so what a route threw
// lands as a server-owned exception entity through the same door (D-32318
// §Errors) — no second shape, no SQL outside db.ts. The object is named
// `<space>/<app>` by the kernel's route (index.ts), never by a client, and
// learns that name from the first request. Not here yet, deliberately: /ws (a hibernating socket plus
// broadcast), the journal feed that fires effects, `work=` lanes and
// `.order=similar` (both reach outside the store) — see query.ts.
import {
  epochOf,
  mutate,
  plant,
  plantVocab,
  type SchemaOp,
} from '../../src/db.ts'
import { fed } from '../../src/effects.ts'
import { type Mutation, mutationResult } from '../../src/mutation.ts'
import { DoSql, type DoStorage } from '../../src/store/do.ts'
import { grow, parseVocab, type Vocab } from '../../src/store/vocab.ts'
import ops from '../../src/store/schema.json' with { type: 'json' }
import { query } from './query.ts'

// The slice of the Durable Object runtime this Worker touches, structurally,
// so `deno check` reads it without @cloudflare/workers-types.
type Ctx = { storage: DoStorage }
export type Stub = { fetch(req: Request): Promise<Response> }
export type Namespace = {
  idFromName(name: string): unknown
  get(id: unknown): Stub
}

let methodNotAllowed = (allow: string) =>
  Response.json({ error: { code: 'method_not_allowed' } }, {
    status: 405,
    headers: { allow },
  })

export class Store {
  db: DoSql
  name: string

  constructor(ctx: Ctx, _env: unknown) {
    this.db = new DoSql(ctx.storage)
    this.name = String(ctx.storage.kv.get('name') ?? '')
    // First touch plants the whole schema in one transaction; a planted store
    // carries the schema version and skips it forever after.
    if (!this.db.version) plant(this.db, ops as SchemaOp[])
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

  async fetch(req: Request): Promise<Response> {
    let url = new URL(req.url)
    let path = url.pathname
    let db = this.db
    // The object learns its own name from the first request that reaches it.
    if (!this.name) {
      this.name = req.headers.get('x-store') ?? ''
      this.db.kv.put('name', this.name)
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
        // that fires effects off it is still to come.
        let out = mutationResult(
          mutate(
            db,
            mutation,
            fed(),
            req.headers.get('x-via'),
            req.headers.get('x-yak-kernel') == '1',
          ),
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
// kernel spells the name; a client never names a store.
export type Door = (
  path: string,
  init?: RequestInit,
  headers?: Record<string, string>,
) => Promise<Response>

export let storeOf = (ns: Namespace, name: string): Door => {
  let stub = ns.get(ns.idFromName(name))
  return (path, init = {}, headers = {}) =>
    stub.fetch(
      new Request(`http://store${path}`, {
        ...init,
        headers: { ...headers, 'x-store': name },
      }),
    )
}
