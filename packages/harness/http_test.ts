import { equal, test } from '@yaks/testing'
import { pooledHttp } from './http.ts'

let fixture = (send: (id: number, init?: RequestInit) => Promise<Response>) => {
  let clients: { id: number; closed: number; close: () => void }[] = []
  let seen: number[] = []
  let http = pooledHttp({
    client: () => {
      let c = { id: clients.length, closed: 0, close: () => c.closed++ }
      clients.push(c)
      return c
    },
    fetch: (_input, init) => {
      let c = (init as RequestInit & { client: typeof clients[number] }).client
      seen.push(c.id)
      return send(c.id, init)
    },
  })
  return { http, clients, seen }
}

test('a reset pooled connection retries the same body on a fresh connection', async () => {
  let bodies: unknown[] = [], calls = 0
  let f = fixture((id, init) => {
    bodies.push(init?.body)
    if (calls++ == 1) {
      return Promise.reject(new TypeError('http2 error: stream reset'))
    }
    return Promise.resolve(new Response(String(id)))
  })
  equal(await (await f.http.fetch('https://provider.test')).text(), '0')
  equal(
    await (await f.http.fetch('https://provider.test', {
      method: 'POST',
      body: '{"model":"test"}',
    })).text(),
    '1',
  )
  equal(f.seen, [0, 0, 1])
  equal(bodies, [undefined, '{"model":"test"}', '{"model":"test"}'])
  equal(f.clients.map((c) => c.closed), [1, 0])
  f.http.close()
  equal(f.clients.map((c) => c.closed), [1, 1])
})

test('retiring a reset pool lets concurrent response streams finish', async () => {
  let calls = 0
  let f = fixture(() =>
    ++calls == 2
      ? Promise.reject(new TypeError('http2 reset'))
      : Promise.resolve(new Response('still streaming'))
  )
  let first = await f.http.fetch('https://provider.test')
  let second = await f.http.fetch('https://provider.test')
  equal(f.clients[0].closed, 0)
  equal(await first.text(), 'still streaming')
  equal(f.clients[0].closed, 1)
  await second.body!.cancel()
  f.http.close()
  equal(f.clients.map((c) => c.closed), [1, 1])
})

test('transport exhaustion is bounded and the next caller gets a clean pool', async () => {
  let f = fixture(() => Promise.reject(new TypeError('http2 reset')))
  let caught: unknown
  try {
    await f.http.fetch('https://provider.test')
  } catch (error) {
    caught = error
  }
  equal(caught instanceof TypeError, true)
  equal(f.seen, [0, 1])
  equal(f.clients.map((c) => c.closed), [1, 1])
  f.http.close()
})

for (let status of [400, 429, 503]) {
  test(`HTTP ${status} is not replayed by the connection pool`, async () => {
    let f = fixture(() => Promise.resolve(new Response(null, { status })))
    equal((await f.http.fetch('https://provider.test')).status, status)
    equal(f.seen, [0])
    f.http.close()
  })
}

test('caller cancellation never retries or retires a healthy pool', async () => {
  let stop = new AbortController()
  let f = fixture(() => {
    stop.abort(new TypeError('cancelled'))
    return Promise.reject(stop.signal.reason)
  })
  try {
    await f.http.fetch('https://provider.test', { signal: stop.signal })
  } catch (error) {
    equal(error, stop.signal.reason)
  }
  equal(f.seen, [0])
  equal(f.clients[0].closed, 0)
  f.http.close()
})

test('an interrupted response retires the pool without replaying delivered output', async () => {
  let f = fixture(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new TypeError('http2 reset during body'))
          },
        }),
      ),
    )
  )
  let response = await f.http.fetch('https://provider.test')
  try {
    await response.text()
  } catch (error) {
    equal(error instanceof TypeError, true)
  }
  equal(f.seen, [0])
  equal(f.clients[0].closed, 1)
  f.http.close()
})

test('a stream upload is not replayed after a transport failure', async () => {
  let f = fixture(() => Promise.reject(new TypeError('http2 reset')))
  try {
    await f.http.fetch('https://provider.test', {
      method: 'POST',
      body: new ReadableStream(),
    })
  } catch (error) {
    equal(error instanceof TypeError, true)
  }
  equal(f.seen, [0])
  f.http.close()
})
