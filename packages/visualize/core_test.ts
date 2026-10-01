/// <reference lib="deno.ns" />
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { channel, peek } from '@yaks/trace'
import type { Anatomy } from '@yaks/code/anatomy'
import { observe } from './activity.ts'
import { capture } from './capture.ts'
import { events, guarded, type Hosting } from './http.ts'
import { located, parts } from './parts.ts'
import { routes } from './routes.ts'
import { GROUPS, select, snapshot } from './snapshot.ts'
import {
  anatomy, door, emptyAnatomy, fixedNow, manualTimers, part, readFrame,
  reasonOf, recorded, req,
} from './testing.ts'

let emit = (graph: object, count = 1) => {
  for (let i = 0; i < count; i++) {
    channel(graph).instant({ kind: 'query', name: 'read' }, { counts: { rows: i } })
  }
}
let allowed = (graph: object = {}): Hosting => ({
  graph, who: () => null, anatomy,
})

test('without a supplier, no empty category claims to have been observed', () => {
  let value = snapshot({})
  assertEquals(value.anatomy.host, 'unobserved')
  assertEquals(Object.values(value.coverage.observed).some(Boolean), false)
  assertEquals(GROUPS.flatMap((g) => value.anatomy[g]), [])
  assertEquals(value.anatomy.edges, [])
  assertEquals(value.coverage.activity, 'process-local')
  assertEquals(value.coverage.recording, 'subscriber-only')
  assert(Number.isFinite(Date.parse(value.takenAt)))
})

test('supplied anatomy is not rewritten and unsupported native categories stay unknown', () => {
  let supplied = anatomy()
  let value = snapshot({ anatomy: () => supplied })
  assert(value.anatomy === supplied)
  assertEquals(value.coverage.observed.packages, true)
  assertEquals(value.coverage.observed.commands, false)
  assertEquals(value.coverage.observed.skills, false)
  assertEquals(value.coverage.observed.views, false)
  let portable = Object.assign(emptyAnatomy('worker'), {
    scope: 'worker:fixture', observed: { tools: true, packages: false },
  })
  let other = snapshot({ anatomy: () => portable })
  assert(other.anatomy === portable)
  assertEquals(other.coverage.scope, 'worker:fixture')
  assertEquals(other.coverage.observed.tools, true)
  assertEquals(other.coverage.observed.packages, false)
  assertEquals(other.coverage.observed.commands, false)
})

test('selection counts parts before truncation and retains only selected endpoints', () => {
  let supplied = anatomy()
  let source = snapshot({ anatomy: () => supplied })
  let chosen = select(source, { limit: 2 })
  assertEquals(chosen.selection, {
    total: 10, matched: 10, shown: 2, truncated: true,
  })
  assertEquals(chosen.anatomy.packages.map((p) => p.id),
    ['package:core', 'package:ui'])
  assertEquals(chosen.anatomy.edges, [])
  for (let group of GROUPS) assert(chosen.anatomy[group] !== supplied[group])
  assert(chosen.anatomy.edges !== supplied.edges)
  assertEquals(supplied.tools.length, 2)
  assertEquals(supplied.edges.length, 4)
  let all = select(source)
  assertEquals(all.selection, {
    total: 10, matched: 10, shown: 10, truncated: false,
  })
  let ids = new Set(GROUPS.flatMap((g) => all.anatomy[g].map((p) => p.id)))
  assert(all.anatomy.edges.every((e) => ids.has(e.from) && ids.has(e.to)))
  assertEquals(all.anatomy.edges, supplied.edges)
})

test('selection combines exact group and ID with case-insensitive metadata search', () => {
  let source = snapshot({ anatomy })
  let chosen = select(source, { group: 'tools', search: '  CAUSAL  ' })
  assertEquals(chosen.selection, {
    total: 10, matched: 1, shown: 1, truncated: false,
  })
  assertEquals(chosen.anatomy.tools.map((p) => p.id), ['tool:load'])
  assertEquals(chosen.anatomy.packages, [])
  assertEquals(select(source, { group: 'tools', search: '@FIXTURE/CORE' })
    .anatomy.tools.map((p) => p.id), ['tool:load'])
  assertEquals(select(source, { search: 'routes' }).selection?.matched, 2)
  assertEquals(select(source, { id: 'tool:load' }).selection?.shown, 1)
  assertEquals(select(source, { id: 'tool:loa' }).selection?.shown, 0)
  assertEquals(select(source, { group: 'packages', id: 'tool:load' })
    .selection?.matched, 0)
  assertEquals(select(source, { group: 'unknown' }).selection?.matched, 0)
})

test('selection normalizes helper bounds without mutating a large supplied roster', () => {
  let supplied: Anatomy = { ...emptyAnatomy(), packages: Array.from(
    { length: 6100 }, (_, i) => ({ ...part(`p:${i}`, `Package ${i}`),
      configured: true }),
  ) }
  let source = snapshot({ anatomy: () => supplied })
  for (let [limit, shown] of [[undefined, 1000], [NaN, 1000], [Infinity, 1000],
    [-1, 1], [0, 1], [2.8, 2], [10000, 5000]] as const) {
    let chosen = select(source, { limit })
    assertEquals(chosen.selection, {
      total: 6100, matched: 6100, shown, truncated: true,
    })
  }
  assertEquals(supplied.packages.length, 6100)
})

test('leases and duplicate listeners close independently on the exact graph', () => {
  let graph = {}
  let other = {}
  let a = observe(graph)
  let b = observe(graph)
  let seen: number[] = []
  let listener = (e: { seq: number }) => seen.push(e.seq)
  let first = a.subscribe(listener)
  let duplicate = a.subscribe(listener)
  let second = b.subscribe(listener)
  try {
    assertEquals(a.epoch, b.epoch)
    assertEquals(peek(other), undefined)
    emit(graph)
    assertEquals(seen, [1, 1, 1])
    first()
    first()
    emit(graph)
    assertEquals(seen.slice(3), [2, 2])
    a.close()
    a.close()
    assertEquals(a.history(), [])
    assert(peek(graph))
    emit(graph)
    assertEquals(seen.at(-1), 3)
    duplicate()
    second()
    b.close()
    assertEquals(peek(graph), undefined)
    assertEquals(channel(graph).begin({ kind: 'apply', name: 'apply' }), undefined)
    assertEquals(a.subscribe(listener)(), undefined)
  } finally {
    a.close()
    b.close()
  }
})

test('observation history is bounded, frozen and normalized, with valid zero durations', () => {
  let graph = {}
  let observation = observe(graph)
  let restore = fixedNow(7)
  try {
    let span = channel(graph).begin({ kind: 'phase', name: 'graph.prepare' })!
    span.end({ counts: { bundles: 0 } })
    let finished = observation.history().at(-1)!
    assertEquals(finished.duration, 0)
    assertEquals(finished.node, 'phase:prepare')
    assertEquals(finished.id, observation.history()[0].id)
    assert(Object.isFrozen(finished))
    emit(graph, 300)
    assertEquals(observation.history().length, 256)
    assertEquals(observation.history()[0].seq, 47)
    assertEquals(observation.history(0), [])
    assertEquals(observation.history(-1), [])
    assertEquals(observation.history(NaN).length, 256)
    assertEquals(observation.history(Infinity).length, 256)
    assertEquals(observation.history(2.9).length, 2)
    let copy = observation.history()
    copy.pop()
    assertEquals(observation.history().length, 256)
  } finally {
    restore()
    observation.close()
  }
})

test('a failed observer does not starve another listener or turn off the channel', () => {
  let graph = {}
  let observation = observe(graph)
  let errors: unknown[][] = []
  let original = console.error
  let seen = 0
  console.error = (...args: unknown[]) => { errors.push(args) }
  try {
    observation.subscribe(() => { throw new Error('listener failed') })
    observation.subscribe(() => { seen++ })
    emit(graph, 2)
    assertEquals(seen, 2)
    assertEquals(errors.length, 2)
    assertEquals(observation.history().length, 2)
    assert(peek(graph))
  } finally {
    console.error = original
    observation.close()
  }
})

test('retained producer history gets a new observation epoch; idle work is not invented', () => {
  let graph = {}
  let first = observe(graph)
  emit(graph)
  let old = first.history()[0]
  first.close()
  assertEquals(channel(graph).instant({ kind: 'query', name: 'read' }), undefined)
  let next = observe(graph)
  try {
    assertNotEquals(next.epoch, old.epoch)
    assertEquals(next.history().map((e) => e.id), [old.id])
    assertEquals(next.history()[0].seq, 1)
    emit(graph)
    assertEquals(next.history().length, 2)
  } finally {
    next.close()
  }
})

test('phase projection is explanatory and part lookup uses only unambiguous evidence', () => {
  let nodes = parts(snapshot({ anatomy }))
  let phase = nodes.find((n) => n.id == 'phase:prepare')!
  assertEquals(phase.group, 'phases')
  assertEquals([phase.loaded, phase.bound], [false, false])
  assertEquals(nodes.find((n) => n.id == 'phase:audit')?.detail.path, 'rollback')
  let event = { id: 'span', kind: 'effect' as const, name: 'deliver',
    stage: 'instant' as const, time: 0, package: '@fixture/core' }
  assertEquals(located(event, nodes), 'effect:deliver')
  assertEquals(located({ ...event, name: 'absent' }, nodes), undefined)
  assertEquals(located(event, [...nodes, { ...nodes.find((n) =>
    n.id == 'effect:deliver')!, id: 'effect:duplicate' }]), undefined)
  assertEquals(located({ ...event, kind: 'phase', name: 'graph.audit' }, nodes),
    'phase:audit')
  assertEquals(located({ ...event, kind: 'phase', name: 'graph.unknown' }, nodes),
    undefined)
})

test('capture counts omitted records, not gap episodes, and releases its own lease', async () => {
  let graph = {}
  let held = observe(graph)
  try {
    emit(graph, 10)
    let value = await capture(graph, { limit: 3 })
    assertEquals(value.events.map((e) => e.seq), [8, 9, 10])
    assertEquals(value.gap, 7)
    assertEquals(value.epoch, held.epoch)
    assertEquals(value.coverage, 'process-local')
    assert(peek(graph))
    assertEquals((await capture(graph, { limit: 10000 })).events.length, 10)
    assertEquals((await capture(graph, { limit: 0 })).events.length, 1)
  } finally {
    held.close()
  }
  assertEquals(peek(graph), undefined)
})

test('capture wait is bounded and overflow during the observation is counted', async () => {
  let timers = manualTimers()
  let graph = {}
  try {
    let waiting = capture(graph, { wait: 10000 })
    assert(peek(graph))
    assertEquals(timers.scheduled.map((t) => t.ms), [2000])
    emit(graph, 400)
    timers.fire(timers.scheduled[0].id)
    let value = await waiting
    assertEquals(value.events.length, 256)
    assertEquals(value.events[0].seq, 145)
    assertEquals(value.gap, 144)
    assertEquals(timers.pending.size, 0)
    assertEquals(peek(graph), undefined)
    assertEquals((await capture({}, { wait: NaN })).events, [])
  } finally {
    timers.restore()
  }
})

test('capture cancellation before and during waiting preserves the reason and cleans up', async () => {
  let timers = manualTimers()
  let graph = {}
  let before = new AbortController()
  let reason = new Error('cancelled capture')
  before.abort(reason)
  try {
    assertEquals(await reasonOf(capture(graph, { signal: before.signal })), reason)
    assertEquals(peek(graph), undefined)
    let stop = new AbortController()
    let waiting = capture(graph, { wait: 2000, signal: stop.signal })
    assertEquals(timers.pending.size, 1)
    stop.abort(reason)
    assertEquals(await reasonOf(waiting), reason)
    assertEquals(timers.pending.size, 0)
    assertEquals(peek(graph), undefined)
  } finally {
    timers.restore()
  }
})

test('all native pages, assets and data fail closed without authenticating or building', async () => {
  let graph = {}
  let reads = 0
  let host: Hosting = { graph, anatomy: () => { reads++; return anatomy() } }
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
  for (let who of [() => null, async () => null]) {
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
      who: () => { throw Object.assign(new Error(secret), {
        name: secret, status, credential: secret,
      }) },
      anatomy: () => { read++; return anatomy() },
      report: () => { reported++; throw new Error('report failed') },
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
  let host = { ...allowed(graph), stopping: stop.signal,
    anatomy: () => { calls++; return anatomy() } }
  request.abort()
  assertEquals((await door(host, '/visualize/anatomy', {
    signal: request.signal,
  })).status, 499)
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
  let selected = await (await door(host,
    '/visualize/anatomy?group=tools&search=load&limit=1')).json()
  assertEquals(selected.selection, {
    total: 10, matched: 1, shown: 1, truncated: false,
  })
  for (let query of ['group=', 'group=unknown', 'limit=', 'limit=0', 'limit=-1',
    'limit=2.5', 'limit=NaN', 'limit=Infinity', 'limit=5001', 'other=1',
    'group=tools&group=tools', 'limit=1&limit=2']) {
    assertEquals((await door(host, `/visualize/anatomy?${query}`)).status, 400,
      query)
  }
  for (let query of ['limit=', 'limit=0', 'limit=257', 'wait=', 'wait=-1',
    'wait=1.5', 'wait=2001', 'wait=0&wait=0', 'search=load']) {
    assertEquals((await door(host, `/visualize/activity?${query}`)).status, 400,
      query)
  }
  assertEquals((await door(host, '/visualize/activity?wait=0&limit=1')).status, 200)
})

test('malformed and future event cursors are refused without leaving a lease', async () => {
  let graph = {}
  for (let id of ['missing-colon', ':1', 'epoch:', 'epoch:-1', 'epoch:1.5',
    'epoch:NaN', 'epoch:9007199254740992']) {
    let response = await events(allowed(graph), req('/visualize/events', {
      headers: { 'last-event-id': id },
    }))
    assertEquals(response.status, 400, id)
    assertEquals(peek(graph), undefined)
  }
  for (let suffix of ['?tail=', '?tail=0', '?tail=1&tail=1', '?other=1']) {
    assertEquals((await events(allowed(graph), req('/visualize/events' + suffix)))
      .status, 400)
    assertEquals(peek(graph), undefined)
  }
  let held = observe(graph)
  try {
    emit(graph, 2)
    let response = await events(allowed(graph), req('/visualize/events', {
      headers: { 'last-event-id': `${held.epoch}:3` },
    }))
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
    let response = await events(allowed(graph), req('/visualize/events', {
      headers: { 'last-event-id': `${held.epoch}:10` },
    }))
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
  assertEquals(channel(graph).instant({ kind: 'query', name: 'read' }), undefined)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    let response = await events(allowed(graph), req('/visualize/events?tail=1', {
      headers: { 'last-event-id': `${old}:2` },
    }))
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
    let a = await events(allowed(graph), req('/visualize/events', {
      signal: request.signal,
    }))
    let b = await events({ ...allowed(graph), stopping: closing.signal },
      req('/visualize/events'))
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
    let waiting = door({ ...allowed(graph), report: () => { reported++ } },
      '/visualize/activity?wait=2000', { signal: stop.signal })
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
    let response = await events(allowed(graph), req('/visualize/events?tail=1', {
      headers: { 'last-event-id': `${held.epoch}:1` },
    }))
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
