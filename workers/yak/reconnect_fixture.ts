// Cold incarnations driven by workerd storage, not a live app.
import { Store } from './graph.ts'
import type { State } from './graph.ts'
import type { Namespace } from './door.ts'

export let reconnect = async (storage: State['storage']) => {
  let app = crypto.randomUUID(),
    person = crypto.randomUUID(),
    space = crypto.randomUUID()
  let queries: string[] = []
  let revoked = false
  let reads = 0, writes = 0, statements = 0
  let measure = false
  let exec = storage.sql.exec.bind(storage.sql)
  let db = {
    ...storage,
    sql: {
      get databaseSize() {
        return storage.sql.databaseSize
      },
      exec(
        query: string,
        ...bindings: (string | number | null | ArrayBuffer)[]
      ) {
        let cursor = exec(query, ...bindings)
        let rows = cursor.toArray()
        if (measure) {
          reads += cursor.rowsRead ?? 0
          writes += cursor.rowsWritten ?? 0
          statements++
        }
        return {
          ...cursor,
          toArray: () => rows,
          [Symbol.iterator]: () => rows.values(),
        }
      },
    },
    transactionSync: <T>(f: () => T) => storage.transactionSync(f),
  }
  let directory: Namespace = {
    idFromName: (n) => n,
    get: () => ({
      fetch: (req: Request) =>
        Promise.resolve((() => {
          let q = new URL(req.url).searchParams.get('q') ?? ''
          queries.push(q)
          if (q.includes(`.entity.eid=${app}`)) {
            return Response.json([{
              entity: { eid: app },
              app: { space, access: 'private' },
            }])
          }
          if (q.includes('.member')) {
            return Response.json(
              revoked ? [] : [{
                entity: { eid: crypto.randomUUID() },
                member: { space, person, role: 'owner' },
              }],
            )
          }
          return Response.json([])
        })()),
    }),
  }
  let closed: { code?: number; reason?: string }[] = []
  let attachment: unknown = { writer: { actor: { by: person, via: 'tab' } } }
  let frames: unknown[] = []
  let ws = {
    readyState: 1,
    send: (s: string) => frames.push(JSON.parse(s)),
    close: (code?: number, reason?: string) => closed.push({ code, reason }),
    serializeAttachment: (v: unknown) => attachment = structuredClone(v),
    deserializeAttachment: () => attachment,
  }
  let ctx = {
    storage: db,
    getWebSockets: () => [ws],
    acceptWebSocket: () => {},
  }
  let headers = {
    'x-store': 'probe/reconnect',
    'x-yak-app': app,
    'x-yak-access': 'private',
    'x-yak-person': person,
    'x-yak-role': 'owner',
  }
  let initial = new Store(ctx, { STORE: directory })
  let res = await initial.fetch(
    new Request('http://store/vocab', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        $defs: {
          cursor: {
            sync: 'peers',
            durable: 'connection',
            properties: { x: { type: 'number' } },
          },
        },
      }),
    }),
  )
  if (!res.ok) throw new Error(await res.text())
  await res.body?.cancel()
  res = await initial.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers,
      body: JSON.stringify([{
        entity: { eid: person },
        doc: { title: 'Hero' },
      }]),
    }),
  )
  if (!res.ok) throw new Error(await res.text())
  await res.body?.cancel()
  // Each new Store represents an eviction with the same held socket. No HTTP
  // request supplies a vouch in the cold incarnation.
  measure = true
  for (let i = 0; i < 14; i++) {
    let store = new Store(ctx, { STORE: directory })
    for (let j = 0; j < 4; j++) {
      await store.webSocketMessage(
        ws,
        JSON.stringify({
          id: 'move',
          relay: [{ entity: { eid: person }, cursor: { x: i * 4 + j } }],
        }),
      )
    }
  }
  measure = false
  let cost = { reads, writes, statements }
  let validCloses = [...closed]
  let validQueries = queries.length
  revoked = true
  let cold = new Store(ctx, { STORE: directory })
  await cold.webSocketMessage(
    ws,
    JSON.stringify({
      id: 'revoked',
      relay: [{ entity: { eid: person }, cursor: { x: 99 } }],
    }),
  )
  return {
    validCloses,
    validQueries,
    cost,
    revokedCloses: closed.slice(validCloses.length),
    frames,
  }
}
