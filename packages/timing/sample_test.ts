/** Selection retains every slow root and one ordinary comparison per op and
 * root-start minute, with an explicit, immutable quota passed between calls. */
import { equal, ok, test } from '@yaks/testing'
import type { Event, Kind } from '@yaks/trace'
import { sample, type SampleOptions } from './mod.ts'

let origin = Date.parse('2026-01-01T00:00:00Z')
let root = (kind: Kind, ms: number, start = 100): Event => ({
  id: '1.1',
  kind,
  name: kind,
  stage: 'end',
  start,
  time: start + ms,
  duration: ms,
})
let select = (events: Event[], options: SampleOptions = { origin }) => {
  let sampled: ReadonlySet<string> = new Set()
  let kept: Event[] = []
  for (let e of events) {
    let result = sample([e], options, sampled)
    sampled = result.sampled
    if (result.trace) kept.push(e)
  }
  return kept
}

test('every slow tree plus exactly one ordinary tree per op per minute', () => {
  let events: Event[] = []
  let expected: Event[] = []
  for (let start of [100, 60_100]) {
    for (
      let [op, threshold] of [
        ['apply', 16],
        ['request', 500],
        ['effect', 1000],
      ] as const
    ) {
      let trees = [threshold + 1, threshold, 0, threshold * 2, 1]
        .map((ms, i) => ({ ...root(op, ms, start), name: `code${i}` }))
      events.push(...trees)
      expected.push(trees[0], trees[1], trees[3])
    }
    let benches = [root('bench', 2000, start), root('bench', 5000, start)]
    events.push(...benches)
    expected.push(benches[0])
  }
  equal(select(events), expected)
})

test('config thresholds, op quota and root-start minute control selection', () => {
  let events = [
    root('apply', 51),
    root('apply', 50),
    root('apply', 49),
    root('apply', 60, 60_100),
    root('apply', 16, 60_100),
    root('request', 501, 60_100),
  ]
  equal(select(events, { origin, thresholds: { apply: 50 } }), [
    events[0],
    events[1],
    events[3],
    events[4],
    events[5],
  ])
  // Finishing in the next minute does not give an earlier root another quota.
  let crossing = root('request', 400, 59_900)
  equal(select([root('request', 100), crossing]), [root('request', 100)])
  equal(select([crossing, root('request', 100, 60_000)]), [
    crossing,
    root('request', 100, 60_000),
  ])
})

test('selection never mutates the quota or consumes it for slow or open roots', () => {
  let initial: ReadonlySet<string> = new Set()
  let ordinary = sample([root('apply', 1)], { origin }, initial)
  equal(initial.size, 0)
  equal(ordinary.sampled.size, 1)
  equal(
    sample([root('apply', 2)], { origin }, ordinary.sampled).trace,
    undefined,
  )
  let slow = sample([root('apply', 30)], { origin }, initial)
  equal(slow.sampled, initial)
  ok(sample([root('apply', 1)], { origin }, slow.sampled).trace)
  equal(sample([], { origin }, initial), { sampled: initial })
  equal(
    sample([{ ...root('apply', 1), stage: 'start' }], { origin }, initial),
    { sampled: initial },
  )
})

test('stored tree projects metadata, relative times and tree-local ids only', () => {
  let spans: Event[] = [
    { ...root('apply', 20, 1000), outcome: 'ok', counts: { bundles: 2 } },
    {
      ...root('phase', 5, 1002),
      id: '1.2',
      parent: '1.1',
      plugin: '@yaks/task',
      package: '@yaks/graph',
      outcome: 'ok',
    },
    { ...root('fanout', 0, 1003), id: '1.3', parent: '1.2', stage: 'instant' },
    {
      ...root('effect', 0, 1004),
      id: '1.4',
      parent: '1.1',
      stage: 'start',
      duration: undefined,
    },
  ]
  let snapshot = structuredClone(spans)
  let trace = ok(sample(spans, { origin }).trace)
  equal(trace, {
    op: 'apply',
    name: 'apply',
    at: '2026-01-01T00:00:01.000Z',
    ms: 20,
    spans: [
      {
        id: '0',
        kind: 'apply',
        name: 'apply',
        start: 0,
        ms: 20,
        outcome: 'ok',
        counts: { bundles: 2 },
      },
      {
        id: '1',
        parent: '0',
        kind: 'phase',
        name: 'phase',
        plugin: '@yaks/task',
        start: 2,
        ms: 5,
        outcome: 'ok',
      },
      { id: '2', parent: '1', kind: 'fanout', name: 'fanout', start: 3, ms: 0 },
      { id: '3', parent: '0', kind: 'effect', name: 'effect', start: 4 },
    ],
  })
  ;(trace.spans[0].counts as Record<string, number>).bundles = 99
  equal(spans, snapshot)
})
