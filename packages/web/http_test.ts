// The graph HTTP door's restart tolerance, with transport and time injected so
// the suite proves the retry schedule without opening a socket or waiting.
import { request } from './http.ts'
import { timing, watching } from './timing.ts'
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
    // The schedule under test, named here so the suite's own TASKS_BACKOFF
    // (empty, to fail fast against dead hosts) can't rewrite the assertion.
    [100, 200, 400, 800, 1600, 3200],
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
        [100, 200, 400, 800, 1600, 3200],
      ),
    Error,
    'tasks server unavailable after 7 attempts over 6.3s: refused',
  )
  assertEquals(fetch.calls(), 7)
  assertEquals(waits, [100, 200, 400, 800, 1600, 3200])
})

// `task --timing`: the one door every headless request passes says one line
// per answer, and the numbers on it are the server's own bytes (timing.ts).
let timedRun = (header?: string) => () =>
  Promise.resolve(
    new Response('', {
      status: 200,
      headers: header ? { 'server-timing': header } : {},
    }),
  )

let watched = async (
  on: boolean,
  run: () => Promise<Response>,
  url: string,
) => {
  let said: string[] = []
  let say = timing.say
  timing.say = (line) => said.push(line)
  watching(on)
  try {
    await request(url, undefined, run, () => Promise.resolve(), [])
  } finally {
    timing.say = say
    watching(false)
  }
  return said
}

Deno.test('--timing says one line per answer, the header verbatim', async () => {
  assertEquals(
    await watched(
      true,
      timedRun('hops;dur=6, rows;dur=3, total;dur=4'),
      'http://tasks.test/query?.status=wip',
    ),
    ['GET /query?.status=wip 200  hops;dur=6, rows;dur=3, total;dur=4'],
  )
  // A door that sends no timing is still one line — that it says nothing is
  // worth seeing too.
  assertEquals(
    await watched(true, timedRun(), 'http://tasks.test/capabilities'),
    ['GET /capabilities 200'],
  )
})

Deno.test('without --timing the wire is silent', async () => {
  assertEquals(
    await watched(
      false,
      timedRun('hops;dur=6'),
      'http://tasks.test/query?.status=wip',
    ),
    [],
  )
})
