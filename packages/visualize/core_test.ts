/** Snapshot, lease and finite capture contracts. */
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { clock, test } from '@yaks/testing'
import { channel, peek } from '@yaks/trace'
import type { Anatomy } from '@yaks/code/anatomy'
import { observe } from './activity.ts'
import { capture } from './capture.ts'
import { located, parts } from './parts.ts'
import { GROUPS, select, snapshot } from './snapshot.ts'
import {
  anatomy,
  emit,
  emptyAnatomy,
  fixedNow,
  part,
  reasonOf,
} from './testing.ts'

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
    scope: 'worker:fixture',
    observed: { tools: true, packages: false },
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
    total: 10,
    matched: 10,
    shown: 2,
    truncated: true,
  })
  assertEquals(chosen.anatomy.packages.map((p) => p.id), [
    'package:core',
    'package:ui',
  ])
  assertEquals(chosen.anatomy.edges, [])
  for (let group of GROUPS) assert(chosen.anatomy[group] !== supplied[group])
  assert(chosen.anatomy.edges !== supplied.edges)
  assertEquals(supplied.tools.length, 2)
  assertEquals(supplied.edges.length, 4)
  let all = select(source)
  assertEquals(all.selection, {
    total: 10,
    matched: 10,
    shown: 10,
    truncated: false,
  })
  let ids = new Set(GROUPS.flatMap((g) => all.anatomy[g].map((p) => p.id)))
  assert(all.anatomy.edges.every((e) => ids.has(e.from) && ids.has(e.to)))
  assertEquals(all.anatomy.edges, supplied.edges)
})

test('selection combines exact group and ID with case-insensitive metadata search', () => {
  let source = snapshot({ anatomy })
  let chosen = select(source, { group: 'tools', search: '  CAUSAL  ' })
  assertEquals(chosen.selection, {
    total: 10,
    matched: 1,
    shown: 1,
    truncated: false,
  })
  assertEquals(chosen.anatomy.tools.map((p) => p.id), ['tool:load'])
  assertEquals(chosen.anatomy.packages, [])
  assertEquals(
    select(source, { group: 'tools', search: '@FIXTURE/CORE' })
      .anatomy.tools.map((p) => p.id),
    ['tool:load'],
  )
  assertEquals(select(source, { search: 'routes' }).selection?.matched, 2)
  assertEquals(select(source, { id: 'tool:load' }).selection?.shown, 1)
  assertEquals(select(source, { id: 'tool:loa' }).selection?.shown, 0)
  assertEquals(
    select(source, { group: 'packages', id: 'tool:load' })
      .selection?.matched,
    0,
  )
  assertEquals(select(source, { group: 'unknown' }).selection?.matched, 0)
})

test('selection normalizes helper bounds without mutating a large supplied roster', () => {
  let supplied: Anatomy = {
    ...emptyAnatomy(),
    packages: Array.from(
      { length: 6100 },
      (_, i) => ({ ...part(`p:${i}`, `Package ${i}`), configured: true }),
    ),
  }
  let source = snapshot({ anatomy: () => supplied })
  for (
    let [limit, shown] of [
      [undefined, 1000],
      [NaN, 1000],
      [Infinity, 1000],
      [-1, 1],
      [0, 1],
      [2.8, 2],
      [10000, 5000],
    ] as const
  ) {
    let chosen = select(source, { limit })
    assertEquals(chosen.selection, {
      total: 6100,
      matched: 6100,
      shown,
      truncated: true,
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
    assertEquals(
      channel(graph).begin({ kind: 'apply', name: 'apply' }),
      undefined,
    )
    assertEquals(a.subscribe(listener)(), undefined)
  } finally {
    a.close()
    b.close()
  }
})

test('observation history is frozen and normalized, with valid zero durations', () => {
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
  } finally {
    restore()
    observation.close()
  }
})

// Seed an overflowing producer through the same phase and instant event paths.
// The history case measures its bounded reads, not 300 unrelated emissions.
let boundedHistory = (() => {
  let graph = {}
  let observation = observe(graph)
  let restore = fixedNow(7)
  try {
    channel(graph).begin({ kind: 'phase', name: 'graph.prepare' })!
      .end({ counts: { bundles: 0 } })
    emit(graph, 300)
    return observation
  } finally {
    restore()
  }
})()

test('observation history is bounded and normalizes read limits without exposing its array', () => {
  let observation = boundedHistory
  try {
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
    observation.close()
  }
})

test('a failed observer does not starve another listener or turn off the channel', () => {
  let graph = {}
  let observation = observe(graph)
  let errors: unknown[][] = []
  let original = console.error
  let seen = 0
  console.error = (...args: unknown[]) => {
    errors.push(args)
  }
  try {
    observation.subscribe(() => {
      throw new Error('listener failed')
    })
    observation.subscribe(() => {
      seen++
    })
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
  assertEquals(
    channel(graph).instant({ kind: 'query', name: 'read' }),
    undefined,
  )
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
  assertEquals(
    nodes.find((n) => n.id == 'phase:audit')?.detail.path,
    'rollback',
  )
  let event = {
    id: 'span',
    kind: 'effect' as const,
    name: 'deliver',
    stage: 'instant' as const,
    time: 0,
    package: '@fixture/core',
  }
  assertEquals(located(event, nodes), 'effect:deliver')
  assertEquals(located({ ...event, name: 'absent' }, nodes), undefined)
  assertEquals(
    located(event, [...nodes, {
      ...nodes.find((n) => n.id == 'effect:deliver')!,
      id: 'effect:duplicate',
    }]),
    undefined,
  )
  assertEquals(
    located({ ...event, kind: 'phase', name: 'graph.audit' }, nodes),
    'phase:audit',
  )
  assertEquals(
    located({ ...event, kind: 'phase', name: 'graph.unknown' }, nodes),
    undefined,
  )
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

// The capture fixture observes a full overflow once, using the production
// channel and a clock of its own; assertions inspect its bounded result and
// cleanup.
let overflow = await (async () => {
  let time = clock()
  let graph = {}
  let waiting = capture(graph, { wait: 10000, clock: time })
  let observing = !!peek(graph)
  emit(graph, 400)
  // Asked for 10 s, the wait ends at 2 s.
  await time.advance(1999)
  let waited = time.pending()
  await time.advance(1)
  let value = await waiting
  return {
    observing,
    waited,
    value,
    pending: time.pending(),
    closed: peek(graph),
    invalid: (await capture({}, { wait: NaN, clock: time })).events,
  }
})()
test('capture wait is bounded and overflow during the observation is counted', () => {
  assert(overflow.observing)
  assertEquals(overflow.waited, 1)
  assertEquals(overflow.value.events.length, 256)
  assertEquals(overflow.value.events[0].seq, 145)
  assertEquals(overflow.value.gap, 144)
  assertEquals(overflow.pending, 0)
  assertEquals(overflow.closed, undefined)
  assertEquals(overflow.invalid, [])
})

test('capture cancellation before and during waiting preserves the reason and cleans up', async () => {
  let time = clock()
  let graph = {}
  let before = new AbortController()
  let reason = new Error('cancelled capture')
  before.abort(reason)
  assertEquals(
    await reasonOf(capture(graph, { signal: before.signal, clock: time })),
    reason,
  )
  assertEquals(peek(graph), undefined)
  let stop = new AbortController()
  let waiting = capture(graph, { wait: 2000, signal: stop.signal, clock: time })
  assertEquals(time.pending(), 1)
  stop.abort(reason)
  assertEquals(await reasonOf(waiting), reason)
  assertEquals(time.pending(), 0)
  assertEquals(peek(graph), undefined)
})
