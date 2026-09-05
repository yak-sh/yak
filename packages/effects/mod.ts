/**
 * @yaks/effects — the mechanism by which a yaks graph DOES something about the
 * data it commits, without tangling that work into the write path.
 *
 * A write is settled by {@link https://jsr.io/@yaks/graph | @yaks/graph}'s
 * `apply()`. An EFFECT is the other half: a post-commit observer that reacts to
 * committed components — a new `order` row triggers a receipt, a deleted
 * `session` ends its process. This package ships the REGISTRY and the runner
 * only; it defines no concrete effect. A plugin registers its own effects
 * against the component names it cares about.
 *
 * Effects are at-most-once and reconciled on boot; an effect that throws is
 * telemetry, never a rolled-back write. They fire only after the transaction
 * commits, so they see settled data and can never veto it — that is the
 * precondition phase's job, upstream in `apply()`.
 *
 * @module
 */

import type { Comp, Eid } from '@yaks/graph'

/** What happened to one component in a committed change. */
export type Kind = 'created' | 'changed' | 'removed'

/** A committed component change, handed to an effect after commit. */
export type Event = {
  /** what happened */
  kind: Kind
  /** the entity the component belongs to */
  entity: Eid
  /** the component's name */
  name: string
  /** the component's columns after the change (absent on `removed`) */
  comp?: Comp
}

/** A post-commit observer for one component name. */
export type Effect = {
  /** the component name this effect watches */
  on: string
  /** run for each matching committed event */
  run: (event: Event) => void | Promise<void>
}

/**
 * The effect registry: register effects, then dispatch a committed event to the
 * ones watching its component. The implementation lands with the package; this
 * is the shape it satisfies.
 */
export type Registry = {
  /** register an effect */
  add: (effect: Effect) => void
  /** dispatch a committed event to every effect watching its component */
  emit: (event: Event) => Promise<void>
}
