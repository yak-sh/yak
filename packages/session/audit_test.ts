import { assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { Bounced } from './bounce.ts'
import { ids, locked, store } from './harness.ts'

let AT = '2026-03-04T05:06:07.000Z'
let opts = { now: () => AT, mint: () => 'c1' }

// The bounce every test here starts from: run1 holds page1, run2 wants it.
let collide = (s: ReturnType<typeof store>, loser = ids.run2) => {
  let g = locked(s, opts)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  assertThrows(
    () => g.apply([{ entity: { eid: ids.p1 }, claim: { session: loser } }]),
    Bounced,
  )
  return (s.tx((tx) => tx.get(['c1'])) as Bundle[])[0]
}

Deno.test('a bounce is written down after the rollback', () => {
  let s = store()
  assertEquals(collide(s).conflict, {
    target: ids.p1,
    loser: ids.run2,
    holder: ids.run1,
    at: AT,
  })
})

Deno.test('the record survives the batch it condemns', () => {
  // Written through a DETACHED transaction: the batch rolled back, and the
  // record of why did not.
  let s = store()
  collide(s)
  assertEquals(
    (s.tx((tx) => tx.read('.conflict.target=' + ids.p1)) as Bundle[])
      .length,
    1,
  )
})

Deno.test('a side that does not exist is written null', () => {
  // A run born inside the batch that bounced went down with it — pointing at
  // it would mint an identity for an entity that was never committed.
  let s = store()
  assertEquals(
    (collide(s, 'never-committed').conflict as Record<string, unknown>).loser,
    null,
  )
})

Deno.test('any other refusal writes nothing', () => {
  let s = store()
  assertThrows(() =>
    locked(s, opts).apply([
      { entity: { eid: ids.p1 }, page: { nope: 1 } as never },
    ])
  )
  assertEquals((s.tx((tx) => tx.get(['c1'])) as Bundle[]).length, 0)
})
