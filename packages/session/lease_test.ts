import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { Bounced, NotRunning } from './bounce.ts'
import { ids, locked, lockOn, seed, store } from './harness.ts'

let AT = '2026-03-04T05:06:07.000Z'
let clock = { now: () => AT }

Deno.test('a lock lands, stamped with the moment it was taken', () => {
  let s = store()
  locked(s, clock).apply([
    { entity: { eid: ids.p1 }, claim: { session: ids.run1 } },
  ])
  assertEquals(lockOn(s, ids.p1), { session: ids.run1, claimed_at: AT })
})

Deno.test('the same run re-claiming is a refresh, not a take', () => {
  let s = store()
  let g = locked(s, clock)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  assertEquals(lockOn(s, ids.p1)?.session, ids.run1)
})

Deno.test('another run’s take bounces, naming both sides', () => {
  let s = store()
  let g = locked(s, clock)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  let e = assertThrows(
    () => g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run2 } }]),
    Bounced,
  ) as Bounced
  assertEquals([e.on, e.loser, e.holder], [ids.p1, ids.run2, ids.run1])
  assert(/already claimed/.test(e.message))
})

Deno.test('a bounce rolls the whole batch back', () => {
  let s = store()
  let g = locked(s, clock)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  assertThrows(() =>
    g.apply([
      { entity: { eid: ids.p2 }, page: { text: 'sourdough' } },
      { entity: { eid: ids.p1 }, claim: { session: ids.run2 } },
    ]), Bounced)
  let p2 = (s.tx((tx) => tx.get([ids.p2])) as Bundle[])[0]
  assertEquals((p2.page as Record<string, unknown>).text, undefined)
})

Deno.test('a release is unguarded — letting go is how a lock moves', () => {
  let s = store()
  let g = locked(s, clock)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  g.apply([{ entity: { eid: ids.p1 }, claim: null }])
  assertEquals(lockOn(s, ids.p1), undefined)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run2 } }])
  assertEquals(lockOn(s, ids.p1)?.session, ids.run2)
})

Deno.test('two runs taking one lock in one batch collide with each other', () => {
  let s = store()
  assertThrows(
    () =>
      locked(s, clock).apply([
        { entity: { eid: ids.p1 }, claim: { session: ids.run1 } },
        { entity: { eid: ids.p1 }, claim: { session: ids.run2 } },
      ]),
    Bounced,
  )
  assertEquals(lockOn(s, ids.p1), undefined)
})

Deno.test('the holder is read before the cascade could remove it', () => {
  // Deleting the holding run and taking its lock in one batch must still
  // bounce: `precondition` runs before `cascade`, so the lock is still there
  // to be read. A check after the cascade would find nothing and admit it.
  let s = store()
  let g = locked(s, clock)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  assertThrows(
    () =>
      g.apply([
        { entity: { eid: ids.run1 }, $delete: true },
        { entity: { eid: ids.p1 }, claim: { session: ids.run2 } },
      ]),
    Bounced,
  )
  assertEquals(lockOn(s, ids.p1)?.session, ids.run1)
})

Deno.test('a dying run lets its locks go, and the page lives', () => {
  // No code in this package: `claim.session` dies by `release`, and
  // @yaks/graph's cascade does the rest.
  let s = store()
  let g = locked(s, clock)
  g.apply([{ entity: { eid: ids.p1 }, claim: { session: ids.run1 } }])
  g.apply([{ entity: { eid: ids.run1 }, $delete: true }])
  assertEquals(lockOn(s, ids.p1), undefined)
  let p1 = (s.tx((tx) => tx.get([ids.p1])) as Bundle[])[0]
  assertEquals((p1.page as Record<string, unknown>).title, 'Lemon cake')
})

Deno.test('a stop lands on a run that is still going', () => {
  let s = store()
  locked(s, clock).apply([
    { entity: { eid: 'stop1' }, stop_request: { target: ids.run1 } },
  ])
  let r = (s.tx((tx) => tx.get(['stop1'])) as Bundle[])[0]
  assertEquals((r.stop_request as Record<string, unknown>).target, ids.run1)
})

Deno.test('a stop is refused for a run that ended, or was never seen', () => {
  let s = store()
  let g = locked(s, clock)
  let e = assertThrows(
    () =>
      g.apply([
        { entity: { eid: 'stop1' }, stop_request: { target: ids.over } },
      ]),
    NotRunning,
  ) as NotRunning
  assertEquals(e.status, 'ended')
  assert(/stop_request refused/.test(e.message))
  assertEquals(
    (assertThrows(
      () =>
        g.apply([
          { entity: { eid: 'stop2' }, stop_request: { target: 'nobody' } },
        ]),
      NotRunning,
    ) as NotRunning).status,
    undefined,
  )
})

Deno.test('a stop is refused for a run that never said it was alive', () => {
  let s = store()
  seed(s, { entity: { eid: 'quiet' }, session: { id: 'quiet' } })
  assertThrows(
    () =>
      locked(s, clock).apply([
        { entity: { eid: 'stop1' }, stop_request: { target: 'quiet' } },
      ]),
    NotRunning,
  )
})

Deno.test('a batch touching neither locks nor stops is untouched', () => {
  let s = store()
  let out = locked(s, clock).apply([
    { entity: { eid: ids.p1 }, page: { text: 'three lemons' } },
  ]) as Bundle[]
  assertEquals((out[0].page as Record<string, unknown>).text, 'three lemons')
})
