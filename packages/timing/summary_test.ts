/** Closed-minute measurements preserve additive histograms and code
 * attribution, independently of process and event lifecycle metadata. */
import { equal, ok, test } from '@yaks/testing'
import type { Event } from '@yaks/trace'
import { bounds, summarize, type TimingRow } from './mod.ts'

let origin = Date.parse('2026-01-01T00:00:00Z')
let context = { origin, before: origin + 120_000, process: 'one' }
let end = (ms: number, more: Partial<Event> = {}): Event => ({
  id: '1.1',
  kind: 'apply',
  name: 'apply',
  stage: 'end',
  time: 100,
  start: 100 - ms,
  duration: ms,
  ...more,
})

// Pool the measurements a reader would combine, leaving process identity out.
let pooled = (rows: TimingRow[]) => {
  let groups = new Map<string, TimingRow['timing']>()
  for (let { timing: t } of rows) {
    let key = JSON.stringify([t.op, t.name, t.plugin, t.at])
    let prior = groups.get(key)
    if (!prior) {
      groups.set(key, {
        ...t,
        buckets: [...t.buckets],
        counts: { ...t.counts },
      })
      continue
    }
    prior.n += t.n
    prior.total += t.total
    prior.max = Math.max(prior.max, t.max)
    prior.buckets = prior.buckets.map((n, i) => n + t.buckets[i])
    for (let [name, n] of Object.entries(t.counts)) {
      prior.counts[name] = (prior.counts[name] ?? 0) + n
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b))
}

test('two processes pool to one process across minutes and plugins', () => {
  let durations = [0, 2 ** -20, 2 ** -10, 0.5, 1, 2, 16, 1000, 2 ** 31]
  let events = durations.flatMap((ms, i) => [
    end(ms, { counts: { bundles: i, rows: i * 2 } }),
    end(ms, {
      kind: 'phase',
      name: 'gather',
      plugin: i % 2 ? '@yaks/task' : '@yaks/tracker',
      time: 60_100,
      counts: { rows: i },
    }),
  ])
  let a = summarize(events.filter((_, i) => i % 3 == 0), context)
  let b = summarize(events.filter((_, i) => i % 3 != 0), {
    ...context,
    process: 'two',
  })
  let all = summarize(events, context)
  equal(pooled([...a, ...b]), pooled(all))
  equal(all.length, 3)
  let apply = all.find((r) => r.timing.op == 'apply')!.timing
  equal(apply.n, durations.length)
  equal(apply.buckets.reduce((a, b) => a + b), durations.length)
  equal(apply.counts, { bundles: 36, rows: 72 })
})

test('zero, exact bounds, near bounds and overflow retain all observations', () => {
  let ms = [
    0,
    2 ** -20,
    bounds[0],
    bounds[0] * 1.5,
    1,
    1 + 2 ** -52,
    bounds.at(-1)!,
    bounds.at(-1)! * 2,
  ]
  let histogram = summarize(ms.map((n) => end(n)), context)[0].timing.buckets
  equal(histogram.reduce((a, b) => a + b), ms.length)
  equal(histogram[0], 1)
  equal(histogram[1], 2)
  equal(histogram[2], 1)
  equal(histogram[11], 1)
  equal(histogram[12], 1)
  equal(histogram.at(-2), 1)
  equal(histogram.at(-1), 1)
})

test('starts do not double-count, instants count zero and open minutes stay out', () => {
  let events = [
    end(8, { stage: 'start' }),
    end(8),
    end(0, { stage: 'instant', duration: undefined, counts: { rows: 2 } }),
    end(12, { time: 60_000, start: 59_988 }),
    end(5, { time: 120_000 }),
  ]
  let closed = summarize(events, { ...context, before: origin + 60_500 })
  equal(closed.length, 1)
  equal(closed[0].timing.n, 2)
  equal(closed[0].timing.total, 8)
  equal(closed[0].timing.max, 8)
  equal(closed[0].timing.counts, { rows: 2 })
  equal(closed[0].timing.at, '2026-01-01T00:00:00.000Z')
  let next = summarize(events, context)
  equal(next.length, 2)
  equal(next[1].timing.at, '2026-01-01T00:01:00.000Z')
  equal(next[1].timing.total, 12)
  equal(closed[0], next[0])
  equal(summarize([], context), [])
})

test('identity includes process and every code coordinate without separator collisions', () => {
  let row = (more: Partial<Event> = {}, process = 'one') =>
    summarize([end(3, more)], { ...context, process, commit: 'commit' })[0]
  let original = row()
  equal(original, row({ id: 'different-channel', counts: undefined }))
  equal(original.during, { process: 'one' })
  equal(original.timing.commit, 'commit')
  for (
    let other of [
      row({}, 'two'),
      row({ kind: 'query' }),
      row({ name: 'read' }),
      row({ plugin: '@yaks/task' }),
      row({ time: 60_100 }),
    ]
  ) ok(original.entity.eid != other.entity.eid)
  ok(
    row({ name: 'gather|rules', plugin: 'hooks' }).entity.eid !=
      row({ name: 'gather', plugin: 'rules|hooks' }).entity.eid,
  )
})
