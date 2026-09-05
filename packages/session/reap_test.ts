import { assertEquals } from '@std/assert'
import { detached } from '@yaks/graph'
import type { Bundle } from '@yaks/graph'
import { reapLeases, staleLeases } from './reap.ts'
import { ids, locked, lockOn, seed, store } from './harness.ts'

let AT = '2026-03-04T05:06:07.000Z'
let clock = { now: () => AT }

// run1 (going) holds page1; the run that ended holds page2.
let held = () => {
  let s = store()
  locked(s, clock).apply([
    { entity: { eid: ids.p1 }, claim: { session: ids.run1 } },
    { entity: { eid: ids.p2 }, claim: { session: ids.over } },
  ])
  return s
}

Deno.test('an ended run’s lock is freed, a going run’s is left alone', () => {
  let s = held()
  let freed = reapLeases(s) as Bundle[]
  assertEquals(freed.map((b) => b.entity.eid), [ids.p2])
  assertEquals(lockOn(s, ids.p2), undefined)
  assertEquals(lockOn(s, ids.p1)?.session, ids.run1)
})

Deno.test('a lock held by a run nobody has heard of is freed', () => {
  let s = store()
  seed(s, { entity: { eid: ids.p1 }, claim: { session: 'ghost' } })
  assertEquals((reapLeases(s) as Bundle[]).length, 1)
  assertEquals(lockOn(s, ids.p1), undefined)
})

Deno.test('reaping twice frees nothing the second time', () => {
  let s = held()
  reapLeases(s)
  assertEquals((reapLeases(s) as Bundle[]).length, 0)
})

Deno.test('a graph with no locks at all is no work', () => {
  assertEquals((reapLeases(store()) as Bundle[]).length, 0)
})

Deno.test('staleLeases only reads — the releases are the caller’s to apply', () => {
  let s = held()
  let free = staleLeases(detached(s)) as Bundle[]
  assertEquals(free, [{ entity: { eid: ids.p2, num: 7 }, claim: null }])
  assertEquals(lockOn(s, ids.p2)?.session, ids.over)
})
