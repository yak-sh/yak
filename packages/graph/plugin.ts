// The pluggable half of `apply()`. A change runs through a fixed, ordered list
// of phases; a plugin registers a hook against a named one. The order matters
// — a precondition has to read before the change writes, a cascade has to
// decide which rows go before they go, an effect must not fire until the
// transaction commits — so "register code anywhere in apply()" would be a way
// to write bugs, not a feature.
//
// A hook takes the list of bundles and returns the list the next phase sees.
// That one signature covers everything a hook does: rewriting a bundle, adding
// one, removing one, and refusing the whole change (by throwing). Hooks
// communicate with each other, and with the core, through the bundles: a
// component is just data on an entity, and a component that never reaches a
// table is a perfectly good way for one phase to tell a later one what it
// decided.

import type { Actor, Bundle, Eid } from './bundle.ts'
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
 * - `admit` — drop undeclared components and server-owned properties, refuse an
 *   undeclared property, validate each value against the vocabulary.
 * - `mint` — give every `$alias` in the change a real id (a fresh one, or one
 *   derived from the content) and rewrite the references to it.
 * - `precondition` — the `$was` check, and any other "may this change be
 *   applied" check that has to read first (a lease, a quota). The transaction
 *   is open by now.
 * - `rules` — the declarative half: a rule is a query, and at this point the
 *   pending change is readable as if it were already in the tables (storage
 *   provides an overlay), so a rule is evaluated against the graph with this
 *   change already applied, and the `+` half of the rule joins the change as
 *   patches. This runs before anything is persisted on purpose — a component
 *   that is never stored (`sync: peers`) is visible to a rule, and can be
 *   produced by one, only while the change is still in memory.
 * - `mutate` — the patches are written.
 * - `cascade` — a delete takes its dependents with it, and references marked
 *   `detach` are cleared. The entities it deleted are added to the change.
 * - `stamp` — `created` when the entity is new, `updated` when it is touched.
 * - `journal` — record the change as applied. (The journal is a plugin.)
 * - `commit` — the last thing inside the transaction; it returns and the
 *   transaction commits.
 * - `effect` — post-commit observers. Each is isolated: a failing effect is
 *   reported, never a failed transaction.
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

/** The phases that run inside the change's transaction. */
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
 * A hook: the bundles in, the bundles the next phase sees out. Throwing
 * refuses the whole change (and, from inside the transaction, rolls it back).
 * In the phases outside the transaction the `tx` is a detached one — each call
 * is its own unit of work. The `audit` phase, and only it, also passes the
 * error that rolled the transaction back.
 */
export type Hook = (
  bundles: Bundle[],
  tx: Tx,
  err?: unknown,
) => Bundle[] | Promise<Bundle[]>

/**
 * An ordered write hook may certify that this change's checks and writes are
 * independent of each other: checking every operation and then mutating and
 * cascading them together produces exactly the same result as checking and
 * writing them one at a time. That covers the hook's rewrites and any
 * cascades, not just its reads. The default is one operation at a time; the
 * operations are combined only when every `beforeWrite` hook certifies the
 * change.
 */
export type WriteHook = Hook & { independent?: boolean }

/**
 * A schema for a tool's arguments or its result. What counts as a schema is
 * the transport's business — {@link https://jsr.io/@yaks/mcp | @yaks/mcp}
 * takes Zod schemas, because the MCP SDK does — so the core leaves this type
 * opaque rather than depending on a validation library.
 */
export type Schema = object

/**
 * What a {@link Tool} is handed beside the call's bundles: the graph to read,
 * who is asking, and the arguments the call carried.
 *
 * `actor` is the caller's, never the runner's: a tool that writes writes in
 * the name of whoever wrote the call, so authorization is decided about the
 * person asking (see {@link https://jsr.io/@yaks/tools | @yaks/tools}). It is
 * the same pair a change carries — `by` the identity, `via` the run it came
 * through — so a tool that needs the session behind a call reads `via`.
 *
 * There is no write method here: a tool returns bundles and the runner applies
 * them, signed, so a tool cannot write in somebody else's name by accident and
 * the calling program can refuse, combine, or replay what it was asked for.
 */
export type ToolCtx = {
  /** the graph the tool works on (its vocabulary and storage included) */
  graph: Graph
  /** who wrote the call — the identity it acts for and the instrument it came
   * through, as the graph stamped them — or `null` for nobody */
  actor: Actor | null
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** the call's arguments, parsed out of `call.args` and checked against the
   * tool's schema by the runner. The same values the call's bundle carries as
   * JSON, so a tool reads them here rather than parsing its own input. */
  args: Record<string, unknown>
  /** the call entity being answered — what a bundle the tool produces records
   * as its source (`output.source`) */
  call: Eid
  /** the working directory of the process running this call, where the calling
   * program knows one. A tool that acts on the machine rather than the graph
   * needs it — `land` fast-forwards the git checkout its caller is in, which
   * on a command line is the directory the person ran it from. A graph in a
   * browser tab or a worker has no working directory, and a tool that requires
   * one has to check for itself. */
  cwd?: string
}

/**
 * A tool: one named operation an agent can ask a graph to perform,
 * contributed the same way a plugin contributes components and hooks. A
 * transport (@yaks/mcp) lists it and calls it; this package only carries the
 * declaration.
 *
 * A tool is a function from bundles to bundles. It is handed the call's own
 * bundle and whatever the caller attached to it; it returns the bundles that
 * are the result — entities it found, entities it wants created, text as
 * `content{body}`. The runner applies them beside the `result{call}` entity in
 * one transaction.
 */
export type Tool<C = ToolCtx, R = Bundle[]> = {
  /** The older flat tool name. A tool declaring `noun`/`verb` derives it from
   * those instead. */
  name?: string
  /** The thing the tool acts on, independent of CLI argument order or graph
   * component names. */
  noun?: string
  /** The operation performed on the noun. Must be supplied together with a
   * noun. */
  verb?: string
  /** JSON Schema object for the complete argument object. Preferred over
   * `input`. */
  inputSchema?: Record<string, unknown>
  /** Optional CLI presentation; ordinary long options use the property names
   * from the schema. */
  options?: {
    positional?: readonly string[]
    short?: Readonly<Record<string, string>>
    /** the property that collects the arguments left over after the
     * positionals are filled: `key=value` pairs for an object, the arguments
     * themselves for an array */
    rest?: string
  }
  /** a short human-readable title */
  title?: string
  /** what it does and when to use it — the agent reads this */
  description: string
  /** one schema per named argument */
  input?: Record<string, Schema>
  /** this tool only reads — a client may call it without asking the user
   * first */
  readOnly?: boolean
  /** this tool can delete or otherwise irreversibly change what it touches, so
   * a client should ask before every call. Creating is not destructive: it
   * only adds, and undoing a create is a delete, which is. Left undeclared, a
   * writing tool is treated as destructive — the safe reading of silence. */
  destructive?: boolean
  /** calling it twice with the same arguments leaves the same state as calling
   * it once — a setter that converges on a value, not something that
   * appends. */
  idempotent?: boolean
  /** it reaches outside this graph: mail to a stranger, a page anyone on the
   * web can then read, a record at another company. A tool that only touches
   * what is stored here is closed-world, whatever it writes. */
  openWorld?: boolean
  /** what the transport should send about this tool beside its schemas, handed
   * to the client verbatim — an MCP `_meta`, say, naming the page the client
   * should render the result in. Opaque here, like {@link Schema}. */
  meta?: Record<string, unknown>
  /** the implementation: the call's bundles in, the result's bundles out */
  run: (bundles: Bundle[], ctx: C) => R | Promise<R>
}

/**
 * A plugin: a self-contained contribution to a graph. It brings a component
 * vocabulary (its domain) and hooks on the phases it cares about. This is the
 * same shape an application uses to add its own components — nothing in this
 * family gets privileged access; it is all plugins.
 */
export type Plugin = {
  /** Transaction-local write tracking. Receives a lookup for the gathered
   * pre-write state (undefined means it was not gathered, null means the
   * entity does not exist). It wraps every phase's writes; `flush` runs before
   * the journal hooks and again after the commit hooks, inside the same
   * transaction. Use it for derived storage metadata, never for external
   * effects. */
  track?: (tx: Tx, found: (eid: Eid) => Bundle | null | undefined) => Tracker
  /** Ordered write policy. The factory sees the storage-ready bundles once;
   * the hook it returns checks or rewrites each live operation against the
   * operations already written before it. Opting in makes mutate and cascade
   * run one operation at a time, in the same transaction. `$was` still checks
   * against the pre-write state. No external side effects: any later refusal
   * rolls back everything written before it. */
  beforeWrite?: (bundles: Bundle[]) => WriteHook
  /** the plugin's name, for diagnostics */
  name: string
  /** the components this plugin contributes, as @yaks/vocab documents */
  vocab?: VocabDoc[]
  /** the `$` keys on a bundle this plugin answers — `['$num']` for the
   * allocator behind @yaks/id's numbers. A request no plugin declares is
   * refused at admission (./request.ts), so asking a graph for something it
   * cannot do is an error rather than silence. */
  requests?: string[]
  /** the phases it hooks, at most one hook each */
  hooks?: Partial<Record<Phase, Hook>>
  /** the rules it registers in code: a query over one bundle in the change,
   * plus what the rule produces (see {@link Rule}). The phase runs every rule
   * registered on it, in plugin order, before its hooks. */
  rules?: Rule[]
  /** the rules it declares as data — a query and nothing else (see
   * {@link Declared}). They run in the `rules` phase, over storage's overlay
   * of the pending change, until they reach a fixpoint, and what they produce
   * joins the change. A declared rule needs no code at all: an app ships one
   * in its vocabulary. */
  declared?: Declared[]
  /** the resources it provides: a singleton built from the current phase's
   * context, which any rule may then bind by `#Name` (see {@link Resource}).
   * The graph provides `#Vocab`, `#Now` and `#Actor` itself; the calling
   * program adds its own — an `#Env`, a `#Request` — as one entry each. A
   * resource name is capitalized, which is what distinguishes it from a
   * component name in the bundle they share; a lowercase name is refused. */
  resources?: Record<string, Resource>
  /** what its hooks are going to read, given the change. `apply()` merges
   * every plugin's asks with its own and satisfies them all in one read before
   * any hook runs (see {@link Ask} and ./gather.ts), so a hook's `tx.get` and
   * `about()` are answered from memory instead of costing a round trip each.
   * Declaring nothing is safe — the reads still work, they just cost what they
   * used to. */
  wants?: (bundles: Bundle[]) => Ask[]
  /** the tools it contributes to a transport that serves them */
  tools?: Tool[]
  /** which of its components are content-addressed, and how each derives its
   * entity's id — consulted in the `mint` phase when such a component arrives
   * under an alias (see {@link Derive}) */
  derive?: Record<string, Derive>
  /** how an id a caller passed becomes an eid, for the ids that are not
   * already one. The returned map holds only the ids that changed, so a caller
   * reads it as `at.get(id) ?? id`, and an id this plugin knows nothing about
   * is simply absent. Called through {@link Graph.address}. It belongs to a
   * plugin rather than the core because "what name refers to an entity" is a
   * question about a component —
   * {@link https://jsr.io/@yaks/alias | @yaks/alias}'s `alias{name}` is the
   * component that answers it. */
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
 * lists beside the tools it has itself. */
export let toolsOf = (plugins: Plugin[]): Tool[] =>
  plugins.flatMap((p) => p.tools ?? [])

/** A transaction-local projection of the writes made so far. `flush` may
 * append bundles it derived, so the journal and the caller both see the same
 * derived data. The second flush covers the journal and commit hooks' own
 * writes without journaling the journal itself. */
export type Tracker = {
  /** The same transaction, with its writes observed; reads behave exactly as
   * the storage contract specifies. */
  tx: Tx
  /** Drain the pending changes; a repeated flush with no writes since does
   * nothing. */
  flush: (bundles: Bundle[]) => Bundle[] | Promise<Bundle[]>
}
