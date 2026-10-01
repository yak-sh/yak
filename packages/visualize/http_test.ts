/** Authenticated native HTTP and bounded SSE contracts. */
/// <reference lib="deno.ns" />
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { channel, peek } from '@yaks/trace'
import { observe } from './activity.ts'
import { events, guarded, type Hosting } from './http.ts'
import { routes } from './routes.ts'
import {
  allowed,
  anatomy,
  door,
  emit,
  manualTimers,
  readFrame,
  recorded,
  req,
} from './testing.ts'

test('all native pages, assets and data fail closed without authenticating or building', async () => {
  let graph = {}
  let reads = 0
  let host: Hosting = {
    graph,
    anatomy: () => {
      reads++
      return anatomy()
    },
  }
  for (let route of routes(host)) {
    let response = await route.handle(req(route.path))
    assertEquals(response.status, 401, route.path)
    assertEquals(response.headers.get('cache-control'), 'no-store')
  }
  assertEquals((await events(host, req('/visualize/events'))).status, 401)
  assertEquals(reads, 0)
  assertEquals(peek(graph), undefined)
})

test('sync and async null policies are intentional and auth settles before work', async () => {
  for (let who of [() => null, () => Promise.resolve(null)]) {
    let host = { ...allowed(), who }
    assertEquals((await door(host, '/visualize/anatomy')).status, 200)
    assertEquals((await door(host, '/visualize/activity')).status, 200)
    let page = routes(host).find((r) => r.path == '/visualize')!
    let response = await page.handle(req('/visualize'))
    assertEquals(response.status, 200)
    assert(response.headers.get('content-type')?.startsWith('text/html'))
  }
  let permitted = Promise.withResolvers<null>()
  let entered = 0
  let answer = guarded({ graph: {}, who: () => permitted.promise }, () => {
    entered++
    return new Response('ready')
  })(req('/visualize'))
  assertEquals(entered, 0)
  permitted.resolve(null)
  assertEquals((await answer).status, 200)
  assertEquals(entered, 1)
})

test('host refusal fields and unknown query keys never disclose a credential', async () => {
  let secret = 'fixture-do-not-disclose'
  let read = 0
  for (let status of [401, 403, 400, 500, 999]) {
    let reported = 0
    let response = await door({
      graph: {},
      who: () => {
        throw Object.assign(new Error(secret), {
          name: secret,
          status,
          credential: secret,
        })
      },
      anatomy: () => {
        read++
        return anatomy()
      },
      report: () => {
        reported++
        throw new Error('report failed')
      },
    }, '/visualize/anatomy')
    assertEquals(response.status, status == 999 ? 500 : status)
    assertEquals((await response.text()).includes(secret), false)
    assertEquals(reported, status >= 500 ? 1 : 0)
  }
  let response = await door(allowed(), `/visualize/anatomy?${secret}=1`)
  assertEquals(response.status, 400)
  assertEquals((await response.text()).includes(secret), false)
  assertEquals(read, 0)
})

test('aborted or closing hosts do not read metadata or acquire an activity lease', async () => {
  let graph = {}
  let stop = new AbortController()
  let request = new AbortController()
  let calls = 0
  let host = {
    ...allowed(graph),
    stopping: stop.signal,
    anatomy: () => {
      calls++
      return anatomy()
    },
  }
  request.abort()
  assertEquals(
    (await door(host, '/visualize/anatomy', {
      signal: request.signal,
    })).status,
    499,
  )
  stop.abort()
  assertEquals((await door(host, '/visualize/events')).status, 503)
  assertEquals(calls, 0)
  assertEquals(peek(graph), undefined)
})

test('HTTP selection preserves full snapshots and refuses invalid parameter shapes', async () => {
  let host = allowed()
  let plain = await (await door(host, '/visualize/anatomy')).json()
  assertEquals(plain.selection, undefined)
  assertEquals(plain.anatomy.tools.length, 2)
  let selected = await (await door(
    host,
    '/visualize/anatomy?group=tools&search=load&limit=1',
  )).json()
  assertEquals(selected.selection, {
    total: 10,
    matched: 1,
    shown: 1,
    truncated: false,
  })
  for (
    let query of [
      'group=',
      'group=unknown',
      'limit=',
      'limit=0',
      'limit=-1',
      'limit=2.5',
      'limit=NaN',
      'limit=Infinity',
      'limit=5001',
      'other=1',
      'group=tools&group=tools',
      'limit=1&limit=2',
    ]
  ) {
    assertEquals(
      (await door(host, `/visualize/anatomy?${query}`)).status,
      400,
      query,
    )
  }
  for (
    let query of [
      'limit=',
      'limit=0',
      'limit=257',
      'wait=',
      'wait=-1',
      'wait=1.5',
      'wait=2001',
      'wait=0&wait=0',
      'search=load',
    ]
  ) {
    assertEquals(
      (await door(host, `/visualize/activity?${query}`)).status,
      400,
      query,
    )
  }
  assertEquals(
    (await door(host, '/visualize/activity?wait=0&limit=1')).status,
    200,
  )
})

test('malformed and future event cursors are refused without leaving a lease', async () => {
  let graph = {}
  for (
    let id of [
      'missing-colon',
      ':1',
      'epoch:',
      'epoch:-1',
      'epoch:1.5',
      'epoch:NaN',
      'epoch:9007199254740992',
    ]
  ) {
    let response = await events(
      allowed(graph),
      req('/visualize/events', {
        headers: { 'last-event-id': id },
      }),
    )
    assertEquals(response.status, 400, id)
    assertEquals(peek(graph), undefined)
  }
  for (let suffix of ['?tail=', '?tail=0', '?tail=1&tail=1', '?other=1']) {
    assertEquals(
      (await events(allowed(graph), req('/visualize/events' + suffix)))
        .status,
      400,
    )
    assertEquals(peek(graph), undefined)
  }
  let held = observe(graph)
  try {
    emit(graph, 2)
    let response = await events(
      allowed(graph),
      req('/visualize/events', {
        headers: { 'last-event-id': `${held.epoch}:3` },
      }),
    )
    assertEquals(response.status, 400)
    held.close()
    assertEquals(peek(graph), undefined)
  } finally {
    held.close()
  }
})

test('SSE hello and same-epoch replay retain order, IDs and explicit omission counts', async () => {
  let timers = manualTimers()
  let graph = {}
  let held = observe(graph)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    emit(graph, 300)
    let response = await events(
      allowed(graph),
      req('/visualize/events', {
        headers: { 'last-event-id': `${held.epoch}:10` },
      }),
    )
    assertEquals(response.headers.get('content-type'), 'text/event-stream')
    assertEquals(response.headers.get('cache-control'), 'no-store')
    reader = response.body!.getReader()
    let hello = await readFrame(reader)
    assertEquals(hello.type, 'hello')
    assertEquals(hello.data.omitted, 34)
    assertEquals(hello.data.reason, 'overflow')
    assertEquals(hello.data.first, 45)
    assertEquals(hello.data.last, 300)
    let first = await readFrame(reader)
    assertEquals(first.type, 'activity')
    assertEquals(recorded(first).seq, 45)
    assertEquals(first.id, `${held.epoch}:45`)
    let next = await readFrame(reader)
    assertEquals(recorded(next).seq, 46)
    await reader.cancel()
    assertEquals(timers.pending.size, 0)
    assert(peek(graph))
  } finally {
    await reader?.cancel()
    held.close()
    timers.restore()
  }
  assertEquals(peek(graph), undefined)
})

test('stream overflow counts records only and hello survives a stalled reader', async () => {
  let timers = manualTimers()
  let graph = {}
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    let response = await events(allowed(graph), req('/visualize/events'))
    emit(graph, 400)
    reader = response.body!.getReader()
    assertEquals((await readFrame(reader)).type, 'hello')
    let received: number[] = []
    let omitted = 0
    for (let i = 0; i < 402 && received.length + omitted < 400; i++) {
      let next = await readFrame(reader)
      if (next.type == 'gap') omitted += next.data.omitted as number
      else {
        assertEquals(next.type, 'activity')
        received.push(recorded(next).seq)
      }
    }
    assertEquals(received.length + omitted, 400)
    assert(omitted > 0)
    assert(received.length <= 264)
    assertEquals(received.at(-1), 400)
    assert(received.every((n, i) => !i || received[i - 1] < n))
    await reader.cancel()
    assertEquals(timers.pending.size, 0)
    assertEquals(peek(graph), undefined)
  } finally {
    await reader?.cancel()
    timers.restore()
  }
})

test('tail resume skips retained observations and cannot reconstruct idle work', async () => {
  let timers = manualTimers()
  let graph = {}
  let held = observe(graph)
  emit(graph, 2)
  let old = held.epoch
  held.close()
  assertEquals(
    channel(graph).instant({ kind: 'query', name: 'read' }),
    undefined,
  )
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    let response = await events(
      allowed(graph),
      req('/visualize/events?tail=1', {
        headers: { 'last-event-id': `${old}:2` },
      }),
    )
    reader = response.body!.getReader()
    let hello = await readFrame(reader)
    assertEquals(hello.data.reason, 'epoch')
    assertNotEquals(hello.data.epoch, old)
    emit(graph)
    let next = await readFrame(reader)
    assertEquals(next.type, 'activity')
    assertEquals(recorded(next).seq, 3)
    assertEquals(recorded(next).epoch, hello.data.epoch)
    await reader.cancel()
    assertEquals(peek(graph), undefined)
    assertEquals(timers.pending.size, 0)
  } finally {
    await reader?.cancel()
    timers.restore()
  }
})

test('stream abort, host close and reader cancellation release independent leases', async () => {
  let timers = manualTimers()
  let graph = {}
  let request = new AbortController()
  let closing = new AbortController()
  let readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  try {
    let a = await events(
      allowed(graph),
      req('/visualize/events', {
        signal: request.signal,
      }),
    )
    let b = await events(
      { ...allowed(graph), stopping: closing.signal },
      req('/visualize/events'),
    )
    readers = [a.body!.getReader(), b.body!.getReader()]
    await readFrame(readers[0])
    await readFrame(readers[1])
    assertEquals(timers.pending.size, 2)
    request.abort()
    assertEquals((await readers[0].read()).done, true)
    assert(peek(graph))
    assertEquals(timers.pending.size, 1)
    closing.abort()
    assertEquals((await readers[1].read()).done, true)
    assertEquals(peek(graph), undefined)
    assertEquals(timers.pending.size, 0)
  } finally {
    for (let reader of readers) await reader.cancel()
    timers.restore()
  }
})

test('cancelling an in-flight HTTP capture is cancellation, not a server fault', async () => {
  let timers = manualTimers()
  let graph = {}
  let stop = new AbortController()
  let reported = 0
  try {
    let waiting = door(
      {
        ...allowed(graph),
        report: () => {
          reported++
        },
      },
      '/visualize/activity?wait=2000',
      { signal: stop.signal },
    )
    await Promise.resolve()
    assert(peek(graph))
    stop.abort()
    let response = await waiting
    assertEquals(response.status, 499)
    assertEquals(reported, 0)
    assertEquals(timers.pending.size, 0)
    assertEquals(peek(graph), undefined)
  } finally {
    timers.restore()
  }
})

test('tail EventSource reconnect honors a same-epoch cursor instead of skipping work', async () => {
  let timers = manualTimers()
  let graph = {}
  let held = observe(graph)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    emit(graph, 3)
    let response = await events(
      allowed(graph),
      req('/visualize/events?tail=1', {
        headers: { 'last-event-id': `${held.epoch}:1` },
      }),
    )
    reader = response.body!.getReader()
    assertEquals((await readFrame(reader)).data.omitted, 0)
    assertEquals(recorded(await readFrame(reader)).seq, 2)
    assertEquals(recorded(await readFrame(reader)).seq, 3)
  } finally {
    await reader?.cancel()
    held.close()
    timers.restore()
  }
})
