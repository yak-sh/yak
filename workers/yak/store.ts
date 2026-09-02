// The Store Durable Object: one SQLite graph per (space, app) — db.ts's
// apply() and query grammar over the DO adapter (src/store/do.ts), planted
// from the generated schema ops on first touch and never migrated. It serves
// the two HTTP doors src/server_runtime.ts serves for headless clients, with
// the same request and response bodies: POST /apply and GET /query, plus GET
// /graph, the identity a joining peer reads, and POST /error, the kernel's
// own door for what an app threw (D-32318 §Errors) — server-owned rows the
// wire may not mint. The object is named `<space>/<app>` by the kernel's
// route (index.ts), never by a client, and learns that name from the first
// request. Not here yet, deliberately: /ws (a hibernating socket plus
// broadcast), the journal feed that fires effects, `work=` lanes and
// `.order=similar` (both reach outside the store) — see query.ts.
import { epochOf, mutate, plant, type SchemaOp } from '../../src/db.ts'
import { fed } from '../../src/effects.ts'
import { type Mutation, mutationResult } from '../../src/mutation.ts'
import { DoSql, type DoStorage } from '../../src/store/do.ts'
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

// What the kernel reports about a request that threw.
export type Thrown = {
  method: string
  path: string
  message: string
  stack: string
  version: number | null
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
        // that fires effects off it is still to come.
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
    if (path == '/error') {
      if (req.method != 'POST') return methodNotAllowed('POST')
      let t = await req.json() as Thrown
      return Response.json({ eid: this.thrown(t) })
    }
    return new Response('not found', { status: 404 })
  }

  // One error entity for one failed request: a doc names the request and
  // carries the stack and the deploy it happened on; the `error` row is
  // server-owned, so it is written by direct SQL the way deliver.ts writes
  // it, never through the wire path that refuses it. One transaction: no
  // doc without its error, no error without its doc.
  thrown({ method, path, message, stack, version }: Thrown) {
    let eid = crypto.randomUUID()
    let db = this.db
    db.transaction(() => {
      mutate(
        db,
        [{
          eid,
          name: 'doc',
          comp: {
            title: `${method} ${path}`,
            body: `version: ${version ?? 'none'}\n\n\`\`\`\n${stack}\n\`\`\`\n`,
          },
        }],
        fed(),
        null,
      )
      db.prepare(
        `insert into error (entity, at, message)
         values ((select id from entity where eid = ?), ?, ?)`,
      ).run(eid, new Date().toISOString(), message)
    })
    return eid
  }
}

// The kernel's door to one store: a caller on the object named
// `<space>/<app>`, told its name on every call (the object keeps the first).
// The kernel spells the name from its route; a client never names a store.
export type Door = (
  path: string,
  init?: RequestInit,
  headers?: Record<string, string>,
) => Promise<Response>

export let storeOf = (ns: Namespace, space: string, app: string): Door => {
  let name = `${space}/${app}`
  let stub = ns.get(ns.idFromName(name))
  return (path, init = {}, headers = {}) =>
    stub.fetch(
      new Request(`http://store${path}`, {
        ...init,
        headers: { ...headers, 'x-store': name },
      }),
    )
}
