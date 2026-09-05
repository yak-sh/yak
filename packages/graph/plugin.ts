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

import type { Bundle, Change, Entity } from './bundle.ts'
import type { Query, ReadOpts, Tx } from './storage.ts'
import type { Ask } from './gather.ts'
import type { Derive } from './alias.ts'
import type { Graph } from './graph.ts'
import type { VocabDoc } from '@yaks/vocab'

/**
 * The phases of `apply()`, in order:
 *
 * - `normalize` — canonicalize what arrived. Pure, before the transaction.
 * - `admit` — drop unknown components and server-owned columns, refuse an
 *   unknown column, check each value against the vocabulary.
 * - `mint` — give every `$alias` in the batch a real id (a fresh one, or one
 *   derived from the content) and rewrite the references to it.
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
  | 'mint'
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
  'mint',
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
 * A schema for a tool's arguments or its result. What counts as one is the
 * TRANSPORT's business — {@link https://jsr.io/@yaks/mcp | @yaks/mcp} takes Zod
 * schemas, because the MCP SDK does — so the core leaves it opaque rather than
 * depending on a validation library.
 */
export type Schema = object

/**
 * What a {@link Tool} is handed when it runs: the graph, who is asking, and the
 * two doors it should use. `apply` signs the batch as `actor`, so a tool cannot
 * write in the client's name by accident; reaching past it to `graph.apply` is
 * the deliberate, unsigned way.
 */
export type ToolCtx = {
  /** the graph the tool works on (its vocabulary and storage included) */
  graph: Graph
  /** the entity the transport authenticated, or `null` for nobody */
  actor: Entity | null
  /** apply a batch, signed as `actor` */
  apply: (change: Change) => Bundle[] | Promise<Bundle[]>
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
}

/**
 * A tool: one named thing an agent can ask a graph to do, contributed the same
 * way a plugin contributes components and hooks. A transport (@yaks/mcp) is
 * what lists it and calls it; this package only carries the declaration.
 *
 * The arguments arrive as a plain bag — the transport has already checked them
 * against `input` — and whatever `run` returns is the tool's structured result,
 * which for most tools is bundles.
 */
export type Tool = {
  /** the tool's name, as an agent calls it */
  name: string
  /** a short human title */
  title?: string
  /** what it does and when to reach for it — the agent reads this */
  description: string
  /** one schema per named argument */
  input?: Record<string, Schema>
  /** the shape of the structured result */
  output?: Schema
  /** this tool only reads — a client may call it without asking first */
  readOnly?: boolean
  /** this tool can DELETE or otherwise irreversibly change what it touches, so
   * a client should ask before every call. A create is not destructive: it
   * only adds, and undoing it is the delete that IS. Left unsaid, a writing
   * tool is taken to be destructive — the safe reading of silence. */
  destructive?: boolean
  /** calling it twice with the same arguments leaves the same world as calling
   * it once — a setter that converges on a value, not an appender. */
  idempotent?: boolean
  /** it reaches OUTSIDE this graph: mail to a stranger, a page anyone on the
   * web can then read, a record at another company. A tool that only touches
   * what is stored here is closed-world, whatever it writes. */
  openWorld?: boolean
  /** what the TRANSPORT should say about this tool beside its schemas, handed
   * to the client verbatim — an MCP `_meta`, say, naming the page a host
   * renders the answer in. Opaque here, like {@link Schema}. */
  meta?: Record<string, unknown>
  /** do it: the arguments in, the structured result out */
  run: (
    args: Record<string, unknown>,
    ctx: ToolCtx,
  ) => unknown | Promise<unknown>
}

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
  /** what its hooks are going to READ, given the batch. `apply()` unions every
   * plugin's asks with its own and answers them all in one gather before a hook
   * runs (see {@link Ask} and ./gather.ts), so a hook's `tx.get` and `about()`
   * are answered from memory instead of costing a round trip each. Declaring
   * nothing is safe — the reads still work, they just cost what they used
   * to. */
  wants?: (bundles: Bundle[]) => Ask[]
  /** the tools it contributes to a transport that serves them */
  tools?: Tool[]
  /** the components of its that are CONTENT-ADDRESSED, and how each names its
   * entity — consulted in the `mint` phase when such a component arrives under
   * an alias (see {@link Derive}) */
  derive?: Record<string, Derive>
}

/** Every vocabulary document a set of plugins contributes, in plugin order —
 * what a caller loads (with any base documents) before binding a storage. */
export let vocabOf = (plugins: Plugin[]): VocabDoc[] =>
  plugins.flatMap((p) => p.vocab ?? [])

/** Every tool a set of plugins contributes, in plugin order — what a transport
 * lists beside its own. */
export let toolsOf = (plugins: Plugin[]): Tool[] =>
  plugins.flatMap((p) => p.tools ?? [])
