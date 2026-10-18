import { equal, test } from '@yaks/testing'
import type { Graph } from '@yaks/graph'
import { routes } from './routes.ts'
let g = {} as Graph
let door = routes({ graph: g }).find((r) => r.path == '/session/earlier')!
test('earlier words refuse browser-origin requests before reading the graph', async () => {
  let r = await door.handle(
    new Request('http://localhost/session/earlier', {
      method: 'POST',
      headers: { origin: 'https://elsewhere.example' },
      body: '{}',
    }),
  )
  equal(r.status, 403)
})
test('malformed earlier-word input is a caller error, not a graph read', async () => {
  let r = await door.handle(
    new Request('http://localhost/session/earlier', {
      method: 'POST',
      body: 'bad json',
    }),
  )
  equal(r.status, 400)
})
test('a host without a configured person discloses no history', async () => {
  let r = await door.handle(
    new Request('http://localhost/session/earlier', {
      method: 'POST',
      body: JSON.stringify({ words: 'files', before: '2026-01-01T00:00:00Z' }),
    }),
  )
  equal(await r.text(), '')
})
