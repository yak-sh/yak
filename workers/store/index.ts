// The store Worker: one Durable Object class, `Store`, whose SQLite holds one
// graph — db.ts's apply() and query grammar over the DO adapter
// (src/store/do.ts), planted from the generated schema ops on first touch and
// never migrated. It serves the two HTTP doors src/server_runtime.ts serves
// for headless clients, with the same request and response bodies: POST /apply
// and GET /query, plus GET /graph, the identity a joining peer reads. The
// object is named by the `x-space` and `x-app` headers (D-32318: one object
// per (space, app)); the kernel worker (T-32326) will set them from the route.
// Not here yet, deliberately: /ws (a hibernating socket plus broadcast), the
// journal feed that fires effects, `work=` lanes and `.order=similar` (both
// reach outside the store) — see query.ts.
import { epochOf, mutate, plant, type SchemaOp } from '../../src/db.ts'
import { fed } from '../../src/effects.ts'
import { type Mutation, mutationResult } from '../../src/mutation.ts'
import { DoSql, type DoStorage } from '../../src/store/do.ts'
import ops from '../../src/store/schema.json' with { type: 'json' }
import { query } from './query.ts'

// The slice of the Durable Object runtime this Worker touches, structurally,
// so `deno check` reads it without @cloudflare/workers-types.
type Ctx = { storage: DoStorage }
type Stub = { fetch(req: Request): Promise<Response> }
type Env = {
  STORE: { idFromName(name: string): unknown; get(id: unknown): Stub }
}

let methodNotAllowed = (allow: string) =>
  Response.json({ error: { code: 'method_not_allowed' } }, {
    status: 405,
    headers: { allow },
  })

export class Store {
  db: DoSql
  name: string

  constructor(ctx: Ctx, _env: Env) {
    this.db = new DoSql(ctx.storage)
    this.name = String(ctx.storage.kv.get('name') ?? '')
    // First touch plants the whole schema in one transaction; a planted store
    // carries the schema version and skips it forever after.
    if (!this.db.version) plant(this.db, ops as SchemaOp[])
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
    if (path == '/query') {
      if (req.method != 'GET') return methodNotAllowed('GET')
      try {
        return Response.json(query(db, url.search))
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
        // that fires effects off it is the kernel worker's (T-32326).
        let out = mutationResult(
          mutate(db, mutation, fed(), req.headers.get('x-via')),
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

export default {
  fetch(req: Request, env: Env) {
    let space = req.headers.get('x-space') ?? 'default'
    let app = req.headers.get('x-app') ?? 'default'
    let name = `${space}/${app}`
    let stub = env.STORE.get(env.STORE.idFromName(name))
    let headers = new Headers(req.headers)
    headers.set('x-store', name)
    return stub.fetch(new Request(req, { headers }))
  },
}
