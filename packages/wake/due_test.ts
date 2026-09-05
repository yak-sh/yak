import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { due, next, ring, soonest, wakeOf } from './due.ts'
import { HOUR, store, T0, woken } from './harness.ts'

let iso = (t: number) => new Date(t).toISOString()
let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

// A store holding one plant and three wakes about it: one owed an hour ago,
// one owed now, one owed in an hour.
let seeded = () => {
  let s = store()
  let g = woken(s)
  g.apply([
    { entity: { eid: 'fern' }, plant: { name: 'the fern' } },
    {
      entity: { eid: 'past' },
      wake: { at: iso(T0 - HOUR), target: 'fern', note: 'water me' },
    },
    { entity: { eid: 'now' }, wake: { at: iso(T0), target: 'fern' } },
    { entity: { eid: 'soon' }, wake: { at: iso(T0 + HOUR), target: 'fern' } },
  ])
  return { s, g }
}

Deno.test('due answers the wakes whose hour has come, oldest first', () => {
  let { s } = seeded()
  assertEquals(eids(due(s, T0) as Bundle[]), ['past', 'now'])
  assertEquals(eids(due(s, T0 - 2 * HOUR) as Bundle[]), [])
  assertEquals(eids(due(s, T0 + HOUR) as Bundle[]), ['past', 'now', 'soon'])
})

Deno.test('a wake carries what it was about, and the line left with it', () => {
  let { s } = seeded()
  let [first] = due(s, T0) as Bundle[]
  assertEquals(wakeOf(first)?.target, 'fern')
  assertEquals(wakeOf(first)?.note, 'water me')
})

Deno.test('a one-shot, rung, is stamped and never due again', () => {
  let { s, g } = seeded()
  let [first] = due(s, T0) as Bundle[]
  g.apply([ring(first, T0)])
  assertEquals(eids(due(s, T0) as Bundle[]), ['now'])
  // it is still there, wearing when it went off
  let [kept] = s.read('.wake!&.fired.at!') as Bundle[]
  assertEquals(kept.entity.eid, 'past')
  assertEquals((kept.fired as { at: string }).at, iso(T0))
  // and never becomes due again, however long the host waits
  assert(!eids(due(s, T0 + 365 * 24 * HOUR) as Bundle[]).includes('past'))
})

Deno.test('a recurring wake, rung, moves on instead of stopping', () => {
  let s = store()
  let g = woken(s)
  g.apply([{
    entity: { eid: 'plants' },
    wake: { at: iso(T0), every: '3d', note: 'water the plants' },
  }])
  let [owed] = due(s, T0) as Bundle[]
  g.apply([ring(owed, T0)])
  assertEquals(eids(due(s, T0) as Bundle[]), [])
  let [w] = s.read('.wake!') as Bundle[]
  assertEquals(wakeOf(w)?.at, '2026-01-04T09:17:00.000Z')
  assertEquals((w.fired as { at: string }).at, iso(T0))
  // and it is owed again when that instant arrives
  assertEquals(eids(due(s, T0 + 3 * 24 * HOUR) as Bundle[]), ['plants'])
})

Deno.test('a recurrence nobody can read fires once and stops', () => {
  let s = store()
  let g = woken(s)
  g.apply([{
    entity: { eid: 'odd' },
    wake: { at: iso(T0), every: 'whenever you get a chance' },
  }])
  let [owed] = due(s, T0) as Bundle[]
  g.apply([ring(owed, T0)])
  assertEquals(eids(due(s, T0 + 365 * 24 * HOUR) as Bundle[]), [])
})

Deno.test('next is the recurrence rule, and null for a one-shot', () => {
  assertEquals(
    next({ at: iso(T0), every: '2h' }, T0),
    '2026-01-01T11:17:00.000Z',
  )
  assertEquals(next({ at: iso(T0) }, T0), null)
  assertEquals(next({ every: '2h' }, T0), null)
  assertEquals(next({ at: 'not a time', every: '2h' }, T0), null)
})

Deno.test('a bare cadence is given its first instant on the way in', () => {
  let s = store()
  woken(s).apply([{ entity: { eid: 'daily' }, wake: { every: '@daily' } }])
  let [w] = s.read('.wake!') as Bundle[]
  assertEquals(wakeOf(w)?.at, '2026-01-02T00:00:00.000Z')
})

Deno.test('soonest is the next instant a host should come back for', () => {
  let { s } = seeded()
  assertEquals(soonest(s, T0), T0 + HOUR)
  assertEquals(soonest(s, T0 + 2 * HOUR), null)
})

Deno.test('a wake dies with the thing it is about', () => {
  let { s, g } = seeded()
  g.apply([{ entity: { eid: 'fern' }, $delete: true }])
  assertEquals(due(s, T0 + HOUR) as Bundle[], [])
})
