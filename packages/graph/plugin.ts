// The pluggable half of `apply()`. A change runs through a FIXED, ordered list
// of phases; a plugin registers a hook against a NAMED one. The order is
// load-bearing — a precondition has to read before the batch writes, a cascade
// has to decide before rows go, an effect must not fire until the transaction
// commits — so "register code anywhere in apply()" would be a way to write
// bugs, not a feature.
//
// A hook takes the batch and returns the batch the next phase sees. That one
// signature covers everything a hook does: rewriting a bundle, adding one,
// dropping one, and refusing the whole batch (by throwing). Hooks talk to each
// other, and to the core, through the bundles: a component is just data on an
// entity, and a component that never reaches a table is a perfectly good way
// for one phase to tell a later one what it decided.

import type { Bundle } from './bundle.ts'
import type { Tx } from './storage.ts'
import type { VocabDoc } from '@yaks/vocab'

/**
 * The phases of `apply()`, in order:
 *
 * - `normalize` — canonicalize what arrived. Pure, before the transaction.
 * - `admit` — drop unknown components and server-owned columns, refuse an
 *   unknown column, check each value against the vocabulary.
 * - `precondition` — the `$was` guard, and any other "may this batch land"
 *   check that has to read (a lease, a quota). The transaction is open.
 * - `mutate` — the patches go in.
 * - `cascade` — a delete takes its dependents with it; detached references let
 *   go. Casualties are synthesized into the batch.
 * - `stamp` — `created` at birth, `updated` on a touch.
 * - `journal` — record the batch as applied. (The journal is a plugin.)
 * - `commit` — the last thing inside the transaction; it returns and commits.
 * - `effect` — post-commit observers. Each is isolated: a failing effect is
 *   telemetry, never a broken batch.
 * - `audit` — after a ROLLBACK, to record what was refused.
 */
export type Phase =
  | 'normalize'
  | 'admit'
  | 'precondition'
  | 'mutate'
  | 'cascade'
  | 'stamp'
  | 'journal'
  | 'commit'
  | 'effect'
  | 'audit'

/** The phases in the order `apply()` runs them. */
export let PHASES: Phase[] = [
  'normalize',
  'admit',
  'precondition',
  'mutate',
  'cascade',
  'stamp',
  'journal',
  'commit',
  'effect',
  'audit',
]

/** The phases that run inside the batch's transaction. */
export let INSIDE: Phase[] = [
  'precondition',
  'mutate',
  'cascade',
  'stamp',
  'journal',
  'commit',
]

/**
 * A hook: the batch in, the batch the next phase sees out. Throwing refuses
 * the whole batch (and, from inside the transaction, rolls it back). In the
 * phases outside the transaction the `tx` is a detached one — each call is its
 * own unit of work. The `audit` phase, and only it, also passes the refusal
 * that rolled the batch back.
 */
export type Hook = (
  bundles: Bundle[],
  tx: Tx,
  err?: unknown,
) => Bundle[] | Promise<Bundle[]>

/**
 * A plugin: a self-contained contribution to a graph. It brings a component
 * vocabulary (its domain) and hooks on the phases it cares about. This is the
 * same shape an application uses to add its own components — the fleet's own
 * machinery is plugins, not privileged code.
 */
export type Plugin = {
  /** the plugin's name, for diagnostics */
  name: string
  /** the components this plugin contributes, as @yaks/vocab documents */
  vocab?: VocabDoc[]
  /** the phases it hooks, at most one hook each */
  hooks?: Partial<Record<Phase, Hook>>
}

/** Every vocabulary document a set of plugins contributes, in plugin order —
 * what a caller loads (with any base documents) before binding a storage. */
export let vocabOf = (plugins: Plugin[]): VocabDoc[] =>
  plugins.flatMap((p) => p.vocab ?? [])
