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

test('a request outlasts a Worker that stops answering for half a minute', async () => {
  let { go, clients } = worker(...Array(6).fill(0).map(timeout))
  equal(await bugs(go), [])
  equal(clients.length, 7)
})

// A Worker every attempt fails the same way.
let down = (failure: Error) => (() => Promise.reject(failure)) as typeof fetch

test('a request that times out every attempt says it was not answered in time', async () =>
  equal(
    await bugs(down(timeout())),
    'TimeoutError: Remote tracker did not answer in time',
  ))

test('a request whose connection fails every attempt says the tracker is unavailable', async () =>
  equal(
    await bugs(down(TypeError('reset'))),
    'Error: Remote tracker is unavailable',
  ))

test("the caller's own deadline ends a request without another attempt", async () => {
  let { go, clients } = worker(timeout())
  equal(
    await bugs(go, { signal: AbortSignal.abort(timeout()) }),
    'TimeoutError: Remote tracker did not answer in time',
  )
  equal(clients.length, 1)
})
