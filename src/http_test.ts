// The graph HTTP door's restart tolerance, with transport and time injected so
// the suite proves the retry schedule without opening a socket or waiting.
import { request } from './http.ts'
import { assertEquals, assertRejects } from '@std/assert'

let response = (status = 200) => new Response('', { status })
let failing = (failures: number, status = 200) => {
  let calls = 0
  let run = () => {
    calls++
    if (calls <= failures) return Promise.reject(new TypeError('refused'))
    return Promise.resolve(response(status))
  }
  return { calls: () => calls, run }
}

Deno.test('request waits through a graph restart', async () => {
  let fetch = failing(3)
  let waits: number[] = []
  let res = await request(
    'http://tasks.test/snapshot',
    undefined,
    fetch.run,
    (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
  )
  assertEquals(res.status, 200)
  assertEquals(fetch.calls(), 4)
  assertEquals(waits, [100, 200, 400])
})

Deno.test('request never replays an HTTP response', async () => {
  let fetch = failing(0, 503)
  let waits: number[] = []
  let res = await request(
    'http://tasks.test/apply',
    { method: 'POST', body: '[]' },
    fetch.run,
    (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
  )
  assertEquals(res.status, 503)
  assertEquals(fetch.calls(), 1)
  assertEquals(waits, [])
})

Deno.test('request never replays a rejected write', async () => {
  let fetch = failing(1)
  let waits: number[] = []
  await assertRejects(
    () =>
      request(
        'http://tasks.test/apply',
        { method: 'POST', body: '[]' },
        fetch.run,
        (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
      ),
    TypeError,
    'refused',
  )
  assertEquals(fetch.calls(), 1)
  assertEquals(waits, [])
})

Deno.test('request names an outage after the retry window', async () => {
  let fetch = failing(Infinity)
  let waits: number[] = []
  await assertRejects(
    () =>
      request(
        'http://tasks.test/snapshot',
        undefined,
        fetch.run,
        (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
      ),
    Error,
    'tasks server unavailable after 7 attempts over 6.3s: refused',
  )
  assertEquals(fetch.calls(), 7)
  assertEquals(waits, [100, 200, 400, 800, 1600, 3200])
})
