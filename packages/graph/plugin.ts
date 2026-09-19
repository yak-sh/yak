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

import type { Bundle, Eid, Entity } from './bundle.ts'
import type { Query, ReadOpts, Tx } from './storage.ts'
import type { Ask } from './gather.ts'
import type { Resource, Rule } from './rules.ts'
import type { Declared } from './declared.ts'
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
 * - `rules` — the DECLARED half: a rule is a query, and here the batch is
 *   readable as tables (a storage's batch OVERLAY), so a rule is judged
 *   against the graph with this batch already in it and its `+` half joins
 *   the batch as patches. Before persistence on purpose — a component that is
 *   never stored (`sync: peers`) is visible to a rule and can be produced by
 *   one only while the batch is still a batch.
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
  | 'rules'
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
  'rules',
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
  'rules',
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
 * An ordered guard may certify that THIS batch's checks and writes are
 * independent: checking all operations before mutating/cascading them together
 * has exactly the same result as checking and writing each prefix. This includes
 * its rewrites and any cascades, not just its reads. Default is ordered; batching
 * is used only when every beforeWrite guard certifies the batch.
 */
export type WriteHook = Hook & { independent?: boolean }

/**
 * A schema for a tool's arguments or its result. What counts as one is the
 * TRANSPORT's business — {@link https://jsr.io/@yaks/mcp | @yaks/mcp} takes Zod
 * schemas, because the MCP SDK does — so the core leaves it opaque rather than
 * depending on a validation library.
 */
export type Schema = object

/**
 * What a {@link Tool} is handed beside the call's bundles: the graph to read,
 * who is asking, and the arguments the call carried.
 *
 * `actor` is the CALLER's, never the runner's: a tool that writes writes in
 * the name of whoever wrote the call, so authorization is decided about the
 * person asking (see {@link https://jsr.io/@yaks/tools | @yaks/tools}).
 *
 * There is no door to write through — a tool ANSWERS with bundles and the
 * runner lands them, signed, so a tool cannot write in somebody else's name by
 * accident and a host can refuse, batch, or replay what it was asked for.
 */
export type ToolCtx = {
  /** the graph the tool works on (its vocabulary and storage included) */
  graph: Graph
  /** the entity that wrote the call, or `null` for nobody */
  actor: Entity | null
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** the call's arguments, parsed out of `call.args` and checked against the
   * tool's schema by the runner. The same values the call's bundle carries as
   * JSON, so a tool reads them here rather than parsing its own input. */
  args: Record<string, unknown>
  /** the call entity being answered — what a bundle the tool makes says it
   * came from (`output.source`) */
  call: Eid
}

/**
 * A tool: one named thing an agent can ask a graph to do, contributed the same
 * way a plugin contributes components and hooks. A transport (@yaks/mcp) is
 * what lists it and calls it; this package only carries the declaration.
 *
 * A tool is a function from BUNDLES to BUNDLES. What it is handed is the
 * call's own bundle and whatever the caller attached to it; what it answers is
 * the bundles that ARE the answer — entities it found, entities it wants
 * made, prose as `content{body}`. The runner lands them beside the
 * `result{call}` entity in one batch.
 */
export type Tool<C = ToolCtx, R = Bundle[]> = {
  /** Legacy transport name. Structured tools derive it from noun and verb. */
  name?: string
  /** the entity a CALL names this tool at, where the graph keeps tool rows of
   * its own. Derived from the name otherwise (@yaks/tools `toolEid`). */
  eid?: Eid
  /** Resource word, independent of CLI word order or graph components. */
  noun?: string
  /** Operation word. Must be supplied together with noun. */
  verb?: string
  /** JSON Schema object for the complete argument object. Preferred over input. */
  inputSchema?: Record<string, unknown>
  /** Optional CLI presentation; ordinary long options use property names. */
  options?: {
    positional?: readonly string[]
    short?: Readonly<Record<string, string>>
    /** the property the bare words left over after the positionals fill:
     * `key=value` pairs for an object, the words themselves for an array */
    rest?: string
  }
  /** a short human title */
  title?: string
  /** what it does and when to reach for it — the agent reads this */
  description: string
  /** one schema per named argument */
  input?: Record<string, Schema>
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
  /** say what the answer is: the call's bundles in, the answer's out */
  run: (bundles: Bundle[], ctx: C) => R | Promise<R>
}

/**
 * A plugin: a self-contained contribution to a graph. It brings a component
 * vocabulary (its domain) and hooks on the phases it cares about. This is the
 * same shape an application uses to add its own components — the fleet's own
 * machinery is plugins, not privileged code.
 */
export type Plugin = {
  /** Transaction-local write tracking. Receives the gathered pre-image lookup
   * (undefined means not gathered, null means absent). Wraps every phase's
   * writes; flush runs before journal and after commit hooks, inside the same
   * transaction. Use it for derived storage metadata, never external effects. */
  track?: (tx: Tx, found: (eid: Eid) => Bundle | null | undefined) => Tracker
  /** Ordered write policy. The factory sees the storage-ready batch once;
   * its hook checks/rewrites each live operation against its already-written
   * prefix. Opting in makes mutate/cascade run per operation, in the SAME
   * transaction. $was remains a pre-write FOUND-state guard. No external
   * side effects: any later refusal rolls the entire prefix back. */
  beforeWrite?: (bundles: Bundle[]) => WriteHook
  /** the plugin's name, for diagnostics */
  name: string
  /** the components this plugin contributes, as @yaks/vocab documents */
  vocab?: VocabDoc[]
  /** the phases it hooks, at most one hook each */
  hooks?: Partial<Record<Phase, Hook>>
  /** the rules it declares — the same seam said as data: a query over one
   * bundle in the batch plus what comes out (see {@link Rule}). The phase runs
   * every rule registered on it, in plugin order, before its hooks. */
  rules?: Rule[]
  /** the rules it DECLARES — a query and nothing else (see {@link Declared}).
   * They run in the `rules` phase, over a storage's batch overlay, to a
   * fixpoint, and what they produce joins the batch. A declared rule needs no
   * code at all: an app ships one in its vocabulary. */
  declared?: Declared[]
  /** the resources it provides: a singleton made from the tick, which any
   * rule may then bind by `#Name` (see {@link Resource}). The graph provides
   * `#Vocab`, `#Now` and `#Actor` itself; a host adds its own — an `#Env`, a
   * `#Request` — as one entry each. A resource is capitalized, which is what
   * keeps it and a component apart in the bundle they share; a lowercase name
   * is refused. */
  resources?: Record<string, Resource>
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
  /** how an id a CALLER typed becomes an eid, for the ids that are not already
   * one. The answer holds only the ids that MOVED, so a door reads it as
   * `at.get(id) ?? id`, and an id this plugin knows nothing about is simply
   * absent. Asked through {@link Graph.address}; the reason it is a plugin's
   * word is that "what names an entity" is a question about a component
   * ({@link https://jsr.io/@yaks/alias | @yaks/alias}'s `alias{name}` is the
   * one that answers it), not about the core. */
  address?: (
    tx: Tx,
    ids: string[],
  ) => Map<string, Eid> | Promise<Map<string, Eid>>
}

/** Every vocabulary document a set of plugins contributes, in plugin order —
 * what a caller loads (with any base documents) before binding a storage. */
export let vocabOf = (plugins: Plugin[]): VocabDoc[] =>
  plugins.flatMap((p) => p.vocab ?? [])

/** Every tool a set of plugins contributes, in plugin order — what a transport
 * lists beside its own. */
export let toolsOf = (plugins: Plugin[]): Tool[] =>
  plugins.flatMap((p) => p.tools ?? [])

/** A transaction-local projection of writes. Flush may append synthesized
 * bundles, so the journal and the caller hear the same derived facts. The
 * second flush includes journal/commit writes without journaling the log itself. */
export type Tracker = {
  /** The transaction with writes observed; reads retain the storage contract. */
  tx: Tx
  /** Drain pending changes; repeated flushes with no writes are no-ops. */
  flush: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
}
