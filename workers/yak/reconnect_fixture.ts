// Cold Store incarnations share in-memory storage and an accepted socket.
import { Store } from './graph.ts'
import type { State } from './graph.ts'
import type { Namespace } from '@yaks/durable-object/door'
import { useUntil } from './used.ts'

/** How many cold incarnations take the held socket's frames, two each. */
export let INCARNATIONS = 2

export let reconnect = async (storage: State['storage']) => {
  let app = crypto.randomUUID(),
    person = crypto.randomUUID(),
    space = crypto.randomUUID()
  let queries: string[] = []
  let revoked = false
  let directory: Namespace = {
    idFromName: (n) => n,
    get: () => ({
      fetch: async (req: Request) => {
        let url = new URL(req.url)
        if (url.pathname == '/used') {
          if (req.method != 'POST' || req.headers.get('x-yak-kernel') != '1') {
            throw new Error('unexpected use request')
          }
          let { eid } = await req.json() as { eid: string }
          if (eid != app) throw new Error('unknown app use')
          return Response.json({ at: useUntil() })
        }
        if (url.pathname != '/query') {
          throw new Error('unexpected directory request')
        }
        let q = url.searchParams.get('q') ?? ''
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
      },
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
    storage,
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
  for (let i = 0; i < INCARNATIONS; i++) {
    let store = new Store(ctx, { STORE: directory })
    for (let j = 0; j < 2; j++) {
      await store.webSocketMessage(
        ws,
        JSON.stringify({
          id: 'move',
          relay: [{ entity: { eid: person }, cursor: { x: i * 2 + j } }],
        }),
      )
    }
  }
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
    revokedCloses: closed.slice(validCloses.length),
    frames,
    accepted: (attachment as { relay?: string[] }).relay ?? [],
  }
}
