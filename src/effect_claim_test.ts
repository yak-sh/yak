// The per-effect claim/settle invariants (D-23772, docs/EFFECT_CLAIMS.md):
// exactly one worker wins one pending row, an expired lease makes work
// retryable, and a stale lease token can never settle over the new claimant.
// The claim guard (`state='pending' OR (state='leased' AND lease_expiry < at)`)
// runs under `begin immediate`, so two claims against one row serialize — the
// loser re-reads an empty frontier. That serialized guard is what these fast
// tests drive; the cross-connection isolation check lives in the slow tier.
import { assert, assertEquals } from '@std/assert'
import { claim, deliver, enqueue, fail, iso } from './effect_claim.ts'
import { bareDb } from './testdb.ts'
import { slow } from './testing.ts'
import { open } from './db.ts'
import { DatabaseSync } from './sqlite.ts'

// A frozen clock, and the same clock plus a shift in ms — expiry without a wait.
let t0 = '2026-08-28T12:00:00.000Z'
let after = (ms: number) => iso(new Date(Date.parse(t0) + ms))

Deno.test('enqueue mints a pending claim and is idempotent on (jrow, handler)', () => {
  let db = bareDb()
  let a = enqueue(db, 7, 'mail')
  let b = enqueue(db, 7, 'mail')
  assertEquals(a, b, 'same (jrow, handler) returns the one claim entity')
  let row = db
    .prepare('select state, attempts from effect where entity = ?')
    .get<{ state: string; attempts: number }>(a)!
  assertEquals(row.state, 'pending')
  assertEquals(row.attempts, 0)
  assertEquals(
    (db.prepare('select count(*) c from effect').get<{ c: number }>()!).c,
    1,
    'no duplicate row, no orphan spine',
  )
})

Deno.test('claim leases exactly one pending row; the racing second claim is empty', () => {
  let db = bareDb()
  enqueue(db, 1, 'send')
  let won = claim(db, 'worker-a', { token: 'tok-a', at: t0 })
  assert(won, 'first claim wins')
  assertEquals(won.state, 'leased')
  assertEquals(won.lease_owner, 'worker-a')
  assertEquals(won.lease_token, 'tok-a')
  assertEquals(won.attempts, 1, 'first lease increments attempts to 1')
  let lost = claim(db, 'worker-b', { token: 'tok-b', at: t0 })
  assertEquals(lost, undefined, 'the row is no longer in the frontier')
})

Deno.test('claim picks nothing when the frontier is empty', () => {
  let db = bareDb()
  assertEquals(claim(db, 'idle', { at: t0 }), undefined)
})

Deno.test('an expired lease is claimable again and attempts increments', () => {
  let db = bareDb()
  enqueue(db, 2, 'wake')
  let first = claim(db, 'a', { token: 'tok-a', ttlMs: 1_000, at: t0 })!
  assertEquals(first.attempts, 1)
  // Before expiry: still leased, not reclaimable.
  assertEquals(
    claim(db, 'b', { token: 'tok-b', at: after(500) }),
    undefined,
    'a live lease is not stolen',
  )
  // Past expiry: reclaimable, attempts climbs.
  let retry = claim(db, 'b', { token: 'tok-b', at: after(2_000) })!
  assert(retry, 'an expired lease returns to the frontier')
  assertEquals(retry.lease_owner, 'b')
  assertEquals(retry.lease_token, 'tok-b')
  assertEquals(retry.attempts, 2, 'the reclaim counts as another attempt')
})

Deno.test('a stale lease token cannot settle over the new claimant', () => {
  let db = bareDb()
  let e = enqueue(db, 3, 'knock')
  let first = claim(db, 'slow', { token: 'stale', ttlMs: 1_000, at: t0 })!
  // The lease expired and a second worker stole it with a fresh token.
  let second = claim(db, 'fast', { token: 'fresh', at: after(2_000) })!
  assertEquals(second.attempts, 2)
  // The evicted worker finally finishes and tries to settle on its stale token.
  assertEquals(deliver(db, e, 'stale'), false, 'stale token is a no-op')
  assertEquals(
    db.prepare('select state from effect where entity = ?')
      .get<{ state: string }>(e)!.state,
    'leased',
    'the row still belongs to the new claimant',
  )
  // Only the current token settles it.
  assertEquals(deliver(db, e, 'fresh'), true)
  assertEquals(
    db.prepare('select state from effect where entity = ?')
      .get<{ state: string }>(e)!.state,
    'delivered',
  )
  assertEquals(first.lease_owner, 'slow') // (the first lease existed)
})

Deno.test('a delivered claim leaves the frontier; fail settles too', () => {
  let db = bareDb()
  let d = enqueue(db, 4, 'sweep')
  let f = enqueue(db, 5, 'sweep')
  let dc = claim(db, 'w', { token: 'td', at: t0 })!
  assertEquals(dc.jrow, 4, 'frontier orders by (jrow, handler)')
  assertEquals(deliver(db, dc.entity, 'td'), true)
  let fc = claim(db, 'w', { token: 'tf', at: t0 })!
  assertEquals(fc.jrow, 5)
  assertEquals(fail(db, fc.entity, 'tf'), true)
  // Both settled — nothing left to claim.
  assertEquals(claim(db, 'w', { at: t0 }), undefined)
  assertEquals(d != f, true)
})

// Real cross-connection isolation: two connections onto one file graph. A
// committed lease on connection A is seen as TAKEN by connection B's claim —
// the `begin immediate` write lock plus committed-state visibility, not a
// same-connection artifact. Slow because it touches the filesystem.
slow(
  'cross-connection: a committed claim is taken from another connection',
  async () => {
    let dir = await Deno.makeTempDir()
    let path = `${dir}/claim.db`
    try {
      open(path).close() // migrate the schema onto the file, then release it.
      let a = new DatabaseSync(path)
      let b = new DatabaseSync(path)
      a.exec('pragma busy_timeout = 2000')
      b.exec('pragma busy_timeout = 2000')
      try {
        enqueue(a, 9, 'mail')
        let won = claim(a, 'a', { token: 'ta', at: t0 })
        assert(won, 'connection A claims the pending row')
        let lost = claim(b, 'b', { token: 'tb', at: t0 })
        assertEquals(lost, undefined, 'connection B sees it already taken')
      } finally {
        a.close()
        b.close()
      }
    } finally {
      await Deno.remove(dir, { recursive: true })
    }
  },
)
