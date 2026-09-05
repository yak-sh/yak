// The other half of a bounce: remembering it.
//
// A refused take is the most interesting thing that happens to a lock — two
// workers wanted one thing, and one of them was told no. That fact is worth
// keeping, and it is exactly the fact a rolled-back transaction destroys. So
// the record is written on the `audit` phase, which runs AFTER the rollback,
// through a DETACHED transaction: a row that condemns a batch cannot ride
// inside it, and a row written into the dead transaction would roll back with
// everything else.
//
// Two consequences of that timing, both deliberate. The record is a separate
// unit of work, so it survives while the batch it describes does not. And it
// is best-effort: @yaks/graph isolates an audit hook and rethrows the original
// refusal either way, so a failed audit is telemetry and never masks the
// refusal the caller is waiting for.
//
// A side that no longer exists is written as null. A run born inside the very
// batch that bounced went down with it, and a reference to an entity that was
// never committed would mint a phantom identity to point at.

import type { Bundle, Eid, Hook } from '@yaks/graph'
import { then, TOMBSTONE } from '@yaks/graph'
import { CONFLICT } from './comp.ts'
import { Bounced } from './bounce.ts'

/** What the audit needs from its host: a clock and a name for the record it
 * writes. */
export type AuditOpts = {
  /** the moment the record is stamped with (default: now, ISO-8601) */
  now?: () => string
  /** the id the record is written under (default: `crypto.randomUUID()`) */
  mint?: () => Eid
}

/**
 * The `audit` hook: turn a {@link Bounced} that rolled a batch back into a
 * `conflict` record, written through the detached transaction the phase
 * receives. Any other refusal passes through untouched — this hook audits
 * collisions, not every failure.
 *
 * Registered by {@link https://jsr.io/@yaks/session/doc/~/sessions | sessions}.
 */
export let auditing = (opts: AuditOpts = {}): Hook => (bundles, tx, err) => {
  if (!(err instanceof Bounced)) return bundles
  let now = opts.now ?? (() => new Date().toISOString())
  let mint = opts.mint ?? (() => crypto.randomUUID() as Eid)
  return then(tx.get([err.loser, err.holder]), (found) => {
    let live = new Set(
      found.filter((b) => b[TOMBSTONE] == null).map((b) => b.entity.eid),
    )
    let record: Bundle = {
      entity: { eid: mint() },
      [CONFLICT]: {
        target: err.on,
        loser: live.has(err.loser) ? err.loser : null,
        holder: live.has(err.holder) ? err.holder : null,
        at: now(),
      },
    }
    return then(tx.patch([record]), () => bundles)
  })
}
