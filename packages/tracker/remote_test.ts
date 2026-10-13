// The Worker is a fetch double whose first answers fail the way a connection
// on a lossy path does.
import { equal, test } from '@yaks/testing'
import { request } from './remote.ts'

let remote = { url: 'https://tracker.example', secret: 'test' }
let timeout = () => new DOMException('timed out', 'TimeoutError')
// Fails with each of `failures` in turn, then answers; records each attempt's
// connection.
let worker = (...failures: Error[]) => {
  let clients: unknown[] = []
  let go = ((_: unknown, init?: RequestInit & { client?: unknown }) => {
    clients.push(init?.client)
    let failure = failures.shift()
    return failure
      ? Promise.reject(failure)
      : Promise.resolve(Response.json([]))
  }) as typeof fetch
  return { go, clients }
}
let bugs = (go: typeof fetch, init?: RequestInit) =>
  request(remote, 'bugs', new URLSearchParams(), init, go)
    .then((r) => r.json(), String)

test('a request whose connection fails or stalls is answered on a new one', async () => {
  for (let failure of [TypeError('connection reset'), timeout()]) {
    let { go, clients } = worker(failure)
    equal(await bugs(go), [])
    equal([clients.length, clients[0] != clients[1]], [2, true])
  }
})

test('a request that fails every attempt names how', async () => {
  equal(
    await bugs(worker(timeout(), timeout(), timeout()).go),
    'TimeoutError: Remote tracker did not answer in time',
  )
  equal(
    await bugs(worker(timeout(), timeout(), TypeError('reset')).go),
    'Error: Remote tracker is unavailable',
  )
})

test("the caller's own deadline ends a request without another attempt", async () => {
  let { go, clients } = worker(timeout())
  equal(
    await bugs(go, { signal: AbortSignal.abort(timeout()) }),
    'TimeoutError: Remote tracker did not answer in time',
  )
  equal(clients.length, 1)
})
