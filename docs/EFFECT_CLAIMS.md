# Concurrent effect dispatch

The temporary `tasks.db-effects.lock` elects one effects dispatcher. It is not a
database lock and must be removed after delivery is coordinated per effect in
SQLite. One or one thousand effects workers must then be equivalent.

Each post-commit effect needs a durable identity derived from its journal row
and handler key. Store its pending, leased, delivered, or failed state with an
attempt count, lease owner, lease token, and lease expiry. A worker claims one
pending or expired effect with a conditional `UPDATE ... RETURNING` inside a
short `BEGIN IMMEDIATE` transaction. Delivery and failure settlement must be
conditional on the same lease token, so an expired worker cannot settle over a
new claimant.

Every external adapter must receive that stable effect identity as its
idempotency key. Lease expiry makes interrupted work retryable; the external key
makes an ambiguous timeout safe to retry. Boot reconciliation is the same claim
loop, not a separate at-most-once path.

Ship this as an additive migration while the current dispatcher remains the only
claimant. Convert every handler and adapter, verify concurrent worker and
lease-expiry tests, then delete `effects_lease.ts` and the lock pathname. A
destructive state change, if ever required, is an explicit offline maintenance
operation rather than part of serving-process startup.
