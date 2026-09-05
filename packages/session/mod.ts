/**
 * @yaks/session — the session and claim component domain for a yaks graph,
 * and the conflict audit that guards a claim.
 *
 * This plugin contributes two components and one rule. A `session` is an
 * actor's run — an agent or a client working the graph. A `claim` is that
 * session's lease on any entity, so two workers do not silently edit the same
 * thing at once. The rule rides the graph's precondition phase: when a write
 * targets an entity another session holds, the claim BOUNCES, and the bounce is
 * recorded as a `conflict` entity rather than lost — an audit of who collided
 * with whom.
 *
 * It plugs into {@link https://jsr.io/@yaks/graph | @yaks/graph} like any other
 * domain; the lease check is a phase hook, so it holds for every write path.
 *
 * @module
 */

import type { Eid, Plugin } from '@yaks/graph'

/** A `session` component: an actor's run over the graph. */
export type Session = {
  /** a human-readable name for the run */
  name?: string
  /** whether the run is still active */
  active: boolean
}

/** A `claim` component: a session's lease on an entity. */
export type Claim = {
  /** the session holding the lease */
  session: Eid
  /** the entity the lease is on */
  on: Eid
}

/** A `conflict` component: the audit of a bounced claim. */
export type Conflict = {
  /** the session whose write bounced */
  loser: Eid
  /** the session that already held the entity */
  holder: Eid
  /** the contested entity */
  on: Eid
}

/**
 * The plugin that contributes `session`, `claim`, and the claim-lease conflict
 * audit to a graph.
 */
export type plugin = () => Plugin
