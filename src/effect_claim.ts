// The per-effect claim/settle primitives (D-23772, docs/EFFECT_CLAIMS.md): the
// SQLite coordination that will replace the `-effects.lock` dispatcher election,
// so one or one thousand effects workers become equivalent. A worker leases ONE
// pending-or-expired `effect` row inside a short `begin immediate` transaction
// and settles it conditionally on the SAME lease token — an expired worker whose
// lease was stolen can never settle over the new claimant.
//
// Still ADDITIVE: nothing here is wired into dispatch yet (that is T-23782); the
// global `-effects.lock` remains the only live claimant. These are the pure
// primitives a future worker calls.
//
// Every column of `effect` is server-owned and written by direct SQL here, never
// the wire. Time is an INJECTED iso string (`at`) so expiry is testable without a
// wall-clock wait: `lease_expiry` is stored as an iso-8601 Z timestamp, which
// sorts chronologically as text, so the `lease_expiry < at` guard is a plain
// string comparison.
import { DatabaseSync } from './sqlite.ts'

// A leased effect row as the claim returns it. `entity` is the claim entity's
// integer id (the `effect` table's pk); `lease_token` is the guard a settle must
// echo.
export type Claim = {
  entity: number
  jrow: number
  handler: string
  state: string
  attempts: number
  lease_owner: string
  lease_token: string
  lease_expiry: string
}

// Now as an iso-8601 Z string — the sortable spelling `lease_expiry` is stored
// in, so the claim guard compares clocks as text.
export let iso = (at: Date = new Date()) => at.toISOString()

// `at` shifted by `ms`, in the same iso spelling — the lease's expiry stamp.
let plus = (at: string, ms: number) => iso(new Date(Date.parse(at) + ms))

// Run `body` inside a short `begin immediate` — the write lock the claim takes
// so two workers racing one pending row serialize, and the loser re-reads an
// empty frontier. Rolls back only a transaction that actually began (a
// SQLITE_BUSY `begin immediate` opens none), mirroring db.ts's rule.
let immediate = <T>(db: DatabaseSync, body: () => T): T => {
  db.exec('begin immediate')
  try {
    let value = body()
    db.exec('commit')
    return value
  } catch (e) {
    if (db.inTransaction) db.exec('rollback')
    throw e
  }
}

// Create a pending claim for one committed effect — the journal ROW that carried
// the change plus the HANDLER key, its durable (jrow, handler) identity. Mints
// the claim's own entity spine, then inserts the row `pending` with zero
// attempts. Idempotent on (jrow, handler): a second enqueue for the same effect
// is a no-op and returns the existing claim's entity id, so no orphan spine is
// minted. Minimal on purpose — the real dispatcher (T-23782) owns wiring this to
// the journal feed; this is the seam the claim/settle tests enqueue against.
export let enqueue = (
  db: DatabaseSync,
  jrow: number,
  handler: string,
): number =>
  immediate(db, () => {
    let found = db
      .prepare('select entity from effect where jrow = ? and handler = ?')
      .get<{ entity: number }>(jrow, handler)
    if (found) return found.entity
    let eid = crypto.randomUUID()
    db.prepare('insert into entity (eid) values (?)').run(eid)
    let { id } = db
      .prepare('select id from entity where eid = ?')
      .get<{ id: number }>(eid)!
    db.prepare(
      `insert into effect (entity, jrow, handler, state, attempts)
       values (?, ?, ?, 'pending', 0)`,
    ).run(id, jrow, handler)
    return id
  })

// Claim ONE pending-or-expired effect for `owner`, leasing it with a fresh
// `token` until `at` + `ttlMs`. The conditional `update … returning` under
// `begin immediate` picks the frontier's first row by its (jrow, handler)
// identity and flips it `leased`, incrementing attempts — but only while the
// guard still holds, so a racing second claimer that wins the write lock re-reads
// an empty frontier and returns undefined. Returns the leased row, or undefined
// when nothing is claimable.
export let claim = (
  db: DatabaseSync,
  owner: string,
  {
    token = crypto.randomUUID(),
    ttlMs = 30_000,
    at = iso(),
  }: { token?: string; ttlMs?: number; at?: string } = {},
): Claim | undefined =>
  immediate(db, () =>
    db
      .prepare(
        `update effect
            set state = 'leased',
                lease_owner = :owner,
                lease_token = :token,
                lease_expiry = :expiry,
                attempts = attempts + 1
          where entity = (
                  select entity from effect
                   where state = 'pending'
                      or (state = 'leased' and lease_expiry < :at)
                   order by jrow, handler
                   limit 1)
            and (state = 'pending'
                 or (state = 'leased' and lease_expiry < :at))
        returning entity, jrow, handler, state, attempts,
                  lease_owner, lease_token, lease_expiry`,
      )
      .get<Claim>({ owner, token, expiry: plus(at, ttlMs), at }))

// Settle a leased claim conditionally on the SAME `token` it was leased with.
// A worker whose lease expired and was re-claimed by another holds a stale token,
// so its settle matches no row and is a silent no-op — the new claimant's work
// stands. Returns true when it settled, false on the token mismatch.
let settle = (
  db: DatabaseSync,
  entity: number,
  token: string,
  state: 'delivered' | 'failed',
): boolean =>
  db
    .prepare(
      `update effect set state = ?
        where entity = ? and lease_token = ? and state = 'leased'`,
    )
    .run(state, entity, token).changes === 1

// Mark a claim delivered — its effect ran. Guarded by the lease token.
export let deliver = (db: DatabaseSync, entity: number, token: string) =>
  settle(db, entity, token, 'delivered')

// Mark a claim failed — its effect errored. Guarded by the lease token; a future
// claim can retry it once the design promotes failed rows back to the frontier
// (not this leaf's concern — it settles, it does not re-enqueue).
export let fail = (db: DatabaseSync, entity: number, token: string) =>
  settle(db, entity, token, 'failed')
