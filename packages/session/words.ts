// The words a run wears, and the one question everything else asks about it:
// is it still going?
//
// A run has a lifecycle — it starts, it works, it is asked to wind down, it
// ends — and exactly one of those states means "somebody is still at the
// keyboard". The lock rules, the stop gate and the boot reap all turn on that
// single predicate, so it is written once, here, rather than three times as
// three slightly different lists of words.
//
// A status is STAMPED: the runner reports it, a client never claims it. A run
// that has said nothing is not going, which is what makes the reap safe — an
// unknown run is a dead run, and its locks are freed.

import type { Comp } from '@yaks/graph'

/** Where a run is in its life: `starting` before it does anything, `running`
 * while it works, `stopping` after it was asked to wind down, `ended` when it
 * is over. */
export type Status = 'starting' | 'running' | 'stopping' | 'ended'

/** Whether a run is mid-thought (`busy`) or waiting for its next instruction
 * (`idle`). Orthogonal to {@link Status}: a running agent is idle between
 * turns and still very much alive. */
export type Turn = 'idle' | 'busy'

/** Every status, in lifecycle order. */
export let STATUSES: Status[] = ['starting', 'running', 'stopping', 'ended']

/** The statuses that mean somebody is still there. `ended` is the only one
 * that is not. */
export let ACTIVE: Status[] = ['starting', 'running', 'stopping']

/** A stored `session.status`, read: a run that never said is `null` — not
 * `starting`. Silence is not a claim to be alive. */
export let status = (v: unknown): Status | null =>
  STATUSES.includes(v as Status) ? v as Status : null

/**
 * Is this run still going? The one predicate the lock rules, the stop gate and
 * {@link https://jsr.io/@yaks/session/doc/~/reapLeases | reapLeases} share.
 *
 * A run is awake while its status is one of {@link ACTIVE} and it has not
 * reported a finish. Anything else — an `ended` run, a run that never said, a
 * missing session — is not.
 */
export let awake = (s?: Comp | null): boolean =>
  !!s && s.finished_at == null && ACTIVE.includes(status(s.status) as Status)
