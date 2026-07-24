// The forward-only compare-and-swap that keeps multi-writer tabs from
// regressing each other's IDB cache (T-6829). ahead() alone decides whether a
// boot result may overwrite what's stored — the rest of idb.ts is IndexedDB
// plumbing a browser probe exercises (probe_idb.ts).
import { ahead } from './idb.ts'
import { assertEquals } from '@std/assert'

let E = 'epoch-A'
let stamp = (cursor: number, epoch = E) => ({ epoch, vocabHash: 'v', cursor })

// A delta PATCH commits only same-epoch AND strictly ahead: it must never
// regress a peer that already advanced the shared cursor, and never apply
// across a reset epoch (its rowids are meaningless there).
Deno.test('ahead: a delta patch is same-epoch, forward-only', () => {
  assertEquals(ahead({ epoch: E, cursor: 5 }, stamp(9), false), true) // ahead
  assertEquals(ahead({ epoch: E, cursor: 9 }, stamp(9), false), false) // equal
  assertEquals(ahead({ epoch: E, cursor: 12 }, stamp(9), false), false) // behind
  assertEquals(ahead({ epoch: 'other', cursor: 1 }, stamp(9), false), false)
})

// A full SNAPSHOT is self-consistent, so it replaces across a changed epoch
// (a db reset/restore voids the stored cursor) as well as when it reaches a
// higher cursor in the same epoch.
Deno.test('ahead: a full snapshot replaces across epochs or forward', () => {
  assertEquals(ahead({ epoch: 'old', cursor: 999 }, stamp(3), true), true)
  assertEquals(ahead({ epoch: E, cursor: 2 }, stamp(9), true), true) // forward
  assertEquals(ahead({ epoch: E, cursor: 9 }, stamp(9), true), false) // no regress
  assertEquals(ahead({ epoch: E, cursor: 12 }, stamp(9), true), false)
})

// A first visit has nothing stored: the full seed writes (absent cursor reads
// as -1). A delta patch never sees an empty store — first visit always seeds
// full — and the different-epoch guard skips it if it somehow does.
Deno.test('ahead: an empty store yields to a full seed, not a bare patch', () => {
  assertEquals(ahead({}, stamp(0), true), true)
  assertEquals(ahead({}, stamp(0), false), false)
})
