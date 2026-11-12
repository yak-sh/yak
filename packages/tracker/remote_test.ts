import { freshFetch } from '@yaks/process/http'
// The Worker is a fetch double whose first answers fail the way a connection
// on a lossy path does.
import { cleanup, clock, equal, test } from '@yaks/testing'
import { delivery, request, Unavailable } from './remote.ts'

let remote = { url: 'https://tracker.example', secret: 'test' }
let timeout = () => new DOMException('timed out', 'TimeoutError')
// Fails with each of `failures` in turn, then answers; records each attempt's
// connection.
let worker = (...failures: Error[]) => {
  let clients: unknown[] = []
  let go = freshFetch(() => {
    let client = {}
    return {
      fetch: (() => {
        clients.push(client)
        let failure = failures.shift()
        return failure
          ? Promise.reject(failure)
          : Promise.resolve(Response.json([]))
      }) as typeof fetch,
      close: () => {},
    }
  })
  return { go, clients }
}
// What a request answered, or how it failed: `Unavailable` where the tracker
// could not answer for now.
let failure = (error: unknown) =>
  error instanceof Unavailable ? `Unavailable: ${error.message}` : String(error)
let bugs = (go: typeof fetch, init?: RequestInit) =>
  request(remote, 'bugs', new URLSearchParams(), init, go)
    .then((r) => r.json(), failure)

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
    'Unavailable: Remote tracker is unavailable',
  ))

// A tracker that takes `ms` to answer, at either its headers or its body.
// Intake is explicit so advancing the clock never races signing a ticket.
let delayed = (ms: number, body = false) => {
  let time = clock(), calls = 0
  let stop = new AbortController()
  let starts = Array.from({ length: 12 }, () => Promise.withResolvers<void>())
  let go: typeof fetch = (_url, init) => {
    let signal = init!.signal!
    let response = new ReadableStream<Uint8Array>({
      start(controller) {
        let end = () => {
          cancel()
          signal.removeEventListener('abort', abort)
        }
        let abort = () => {
          end()
          controller.error(signal.reason)
        }
        let cancel = time.after(ms, () => {
          end()
          controller.enqueue(new TextEncoder().encode('[]'))
          controller.close()
        })
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      },
    })
    starts[calls++].resolve()
    return body
      ? Promise.resolve(new Response(response))
      : new Response(response).arrayBuffer().then((bytes) =>
        new Response(bytes)
      )
  }
  let answer = request(
    remote,
    'bugs',
    new URLSearchParams(),
    {
      signal: stop.signal,
    },
    go,
    time,
  )
    .then((r) => r.json(), failure)
  cleanup(async () => {
    stop.abort()
    await answer
  })
  return { time, starts, answer, calls: () => calls }
}

for (let body of [false, true]) {
  test(`a slow tracker's ${body ? 'body' : 'headers'} can finish on a later attempt`, async () => {
    let { time, starts, answer, calls } = delayed(6000, body)
    await starts[0].promise
    await time.advance(5000)
    await starts[1].promise
    await time.advance(6000)
    await time.advance(0)
    equal(await Promise.race([answer, Promise.resolve('pending')]), [])
    equal(calls(), 2)
    equal(time.pending(), 0)
  })
}

test('longer attempts still end an unanswered request within one minute', async () => {
  let { time, starts, answer, calls } = delayed(Infinity)
  for (let [i, ms] of [5000, 10000, 20000, 25000].entries()) {
    await starts[i].promise
    await time.advance(ms)
  }
  await time.advance(0)
  equal(
    await Promise.race([answer, Promise.resolve('pending')]),
    'TimeoutError: Remote tracker did not answer in time',
  )
  equal(calls(), 4)
  equal(time.now(), 60_000)
  equal(time.pending(), 0)
})

test("the caller's own deadline ends a request without another attempt", async () => {
  let { go, clients } = worker(timeout())
  equal(
    await bugs(go, { signal: AbortSignal.abort(timeout()) }),
    'TimeoutError: Remote tracker did not answer in time',
  )
  equal(clients.length, 1)
})

test('a caller stopping a request preserves its cancellation, not an outage', async () => {
  let stop = new AbortController(), calls = 0
  let go = (() => {
    calls++
    stop.abort()
    return Promise.reject(stop.signal.reason)
  }) as typeof fetch
  let error = await request(remote, 'bugs', new URLSearchParams(), {
    signal: stop.signal,
  }, go).catch((error) => error)
  equal(error, stop.signal.reason)
  equal(calls, 1)
})

// A delivery the tracker could not answer for now is `Unavailable`, which
// the next pass rides out; any other failure is a bug.
let delivered = (status: number, at = remote) =>
  delivery(at, () => Promise.resolve(new Response(null, { status })))([])
    .then(() => 'sent', failure)

test('a delivery the tracker could not answer for now is unavailable, and any other failure is not', async () => {
  equal(
    await Promise.all([
      delivered(503),
      delivered(429),
      delivered(400),
      delivered(200, { ...remote, url: 'http://tracker.example' }),
    ]),
    [
      'Unavailable: Remote tracker refused intake (503)',
      'Unavailable: Remote tracker refused intake (429)',
      'Error: Remote tracker refused intake (400)',
      'Error: Remote tracker address is invalid',
    ],
  )
})

test('a redirect is answered as a refusal and never followed with the ticket', async () => {
  let asked: string[] = []
  let server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    (r) => {
      asked.push(new URL(r.url).pathname)
      return new Response(null, { status: 302, headers: { location: '/away' } })
    },
  )
  let at = { ...remote, url: `http://127.0.0.1:${server.addr.port}` }
  let response = await request(at, 'bugs', new URLSearchParams())
  await server.shutdown()
  equal([response.status, asked], [302, ['/bugs']])
})
