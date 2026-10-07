// The portable contract a host lends every plugin. Concrete hosts own drivers,
// directories and resource lifetime; plugins see the graph and capabilities.
import type { Bundle, Eid, Graph, NamedTool, Storage } from '@yaks/graph'
import type { Search } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import type { Derived, Statements } from '@yaks/sql'
import type { Authenticate, Filter, Handler, Route } from '@yaks/api'
import type { Anatomy, AnatomyObserver } from '@yaks/code/anatomy'
import type { Contributions } from '@yaks/ui'
import type { Blobs } from '@yaks/blob'
import type { Effects } from '@yaks/effects'
import type { Local } from '@yaks/secrets'
import type { Finding, Reply, Runner } from '@yaks/tools'
import type { Config } from './config.ts'
export type { Config, Options, Plug } from './config.ts'
export type Role = string
export type Feed = (
  each: (applied: Bundle[]) => void | Promise<void>,
) => () => void
/** Cooperative storage-change observation. The adapter owns any migration. */
export type MigrationMonitor = {
  read: () => {
    generation: number
    migration: string
    state: 'pending' | 'applied' | 'failed'
    announced: number
    notBefore: number
    finished: number | null
    error: string | null
  } | undefined
  ready: () => number
}
/** What every plugin factory is handed: the graph being assembled, the
 * vocabulary of components and tools it holds, the store under it, the
 * host capabilities and the configuration that named them. `storage`,
 * `graph`, `handler`, `runner` and `duties` are live from the moment each is
 * built — a factory may keep a reference and must not call it before it
 * returns, since an `extend` factory runs before there is a store to read and
 * a `runs` factory is asked for its tools before there is a runner to run
 * them. */
export interface Host {
  /** Already-observed composition metadata; never imports a lazy facet. */
  anatomy: () => Anatomy
  /** Already-loaded metadata only; never triggers an import or a factory. */
  observe?: AnatomyObserver
  config: Config
  /** the roles this process serves over the graph (the roles selected by composition): the
   * facets it imported, and so what else is wired in below */
  roles: readonly Role[]
  vocab: Vocab
  storage: Storage & {
    statements?: Statements
    migrations?: MigrationMonitor
    checks?: {
      storage: () => Finding[]
      archetypes: (sample: number) => Finding[]
    }
  }
  /** where this graph's secrets are kept (./vault.ts): private files beside
   * its database, or memory for a graph in memory — what @yaks/secrets seals
   * into and a config's `{"secret": "NAME"}` is read from */
  vault: Local
  /** where this graph keeps content-addressed text (@yaks/blob): a
   * table in its own database — what a `store: blob` property is written to,
   * and where @yaks/page keeps an archived page unless it names a directory */
  blobs: Blobs
  /** binary artifacts shared by the harness and the HTTP blob door */
  artifacts: Blobs
  /** every property the store reads through an expression rather than as
   * stored, keyed `comp.prop` — a @yaks/blob body resolves its address to its
   * text — so a plugin reading SQL directly reads what the store reads */
  derived: Derived
  graph: Graph
  /** A web role can answer graph reads beside its HTTP thread. */
  reader?: Pick<Graph, 'read' | 'rows' | 'get'>
  /** the post-commit registry: what a commit owes, written down by every
   * process (@yaks/effects), and the observers a plugin registers while one of
   * its tools runs */
  fx: Effects
  /** every route of this host as one request handler — built by the listed
   * plugin that hosts routes ({@link RoutesFacet.handler}, @yaks/api) in a
   * process serving `web`, and absent anywhere else. Whether any process
   * listens with it is the `serve` tool's business (@yaks/api). */
  handler?: Handler
  /** every HTTP route the listed plugins contributed, in the order the config
   * names them. Gathered only by a process serving `web` where a plugin
   * hosts them: nothing else here answers a request. */
  ui: Contributions
  routes: Route[]
  /** every filter the listed plugins put in front of those routes
   * ({@link RoutesFacet.filter}), gathered where the routes are. */
  filters: Filter[]
  /** every tool declared across the plugins, joined to the code behind it,
   * with this graph's own generic tier (@yaks/graph `tier`) first. One list: a
   * command line runs it, and a transport that lists tools lists it. */
  tools: NamedTool[]
  /** ranked text search over this graph, where its vocabulary marks a property
   * `search: true` and @yaks/fts indexed it — what the tier's `search` tool
   * answers with, and what a transport restating the tier asks for. */
  search?: Search
  /** what a direct tool call is owed beside its answer, from every plugin
   * that offers some : what {@link runner} adds, and
   * what a runner of another's tools over this graph adds too (@yaks/harness).
   * Absent where no plugin offers any. */
  reply?: Reply
  /** the one tool runner over this graph: what writes a `call` row, runs the
   * function and writes the result back for recorded work. Direct read-only
   * requests validate and answer without recording bookkeeping. */
  runner: Runner
  /** The work this process does that nobody asked for: the effect pool where
   * it serves `effects` (@yaks/effects `work` — any number of processes work
   * it at once), and each plugin's `./service` where it serves that plugin.
   * A service is taken under a lease named for its package (@yaks/effects
   * `holding`), so of all the processes over one graph exactly one is running
   * each — a second long-running process waits, and takes over when a killed
   * holder's lease expires.
   *
   * The duty roles this host handed to a worker run there, under the
   * same signal.
   *
   * Runs until `signal` aborts; left out, that signal is this host's own, so
   * it stops with host shutdown. Pass an already-aborted signal for one
   * pass each and no waiting. A command passing through never starts duties;
   * a host that stays up calls the live form. `only` narrows a pass to the
   * named duty roles. */
  duties: (signal?: AbortSignal, only?: readonly Role[]) => Promise<void>
  /** What host shutdown would have written for a process or a thread
   * that will not write it itself: its calls ended as interrupted, saying
   * `why`, its leases released, its `exit` stamped with no code. What this
   * process writes for a thread of its own that it ended where it stood, or
   * that failed (@yaks/threads), and a thread for itself when it is about to be
   * ended so (@yaks/harness), so nobody waits out what it held. */
  end: (holder: Eid, why: string) => Promise<void>
  /** {@link Host.end} for each process on this machine that ended without
   * closing (@yaks/process `vanished`). What a process about to stay up does
   * before it reconciles (@yaks/api `serve`), so a crash leaves nothing held
   * by the dead. Answers the processes it closed. */
  bury: () => Promise<Bundle[]>
  /** Whether a lease's holder is over (@yaks/process `gone`): a process on
   * this machine whose pid is gone, or one whose row records its `exit`, as a
   * thread its process ended does. What a take asks before waiting out a
   * holder's expiry (@yaks/effects `HoldOpts.gone`). */
  gone: (holder: Eid) => Promise<boolean>

  /** This process, as an entity (@yaks/process `started`): the row it wrote on
   * the way in, what everything it writes is attributed to, and what a
   * start-up effect compares against to tell its own creation from a child
   * process's. */
  me: Eid
  /** who is calling — the answer every door over this graph gets, a command
   * line and @yaks/api's endpoints alike, so what a caller writes is
   * attributed to it (`signed` in @yaks/api) instead of to nobody. At most one
   * plugin answers it ; where it names
   * nobody, the answer is this host process itself (its writer). */
  who: Authenticate
  /** Every commit another host makes to this store, as the patches it applied
   * : what a subscription registry or a cache over
   * {@link graph} is fed so it sees the writes its graph's `effect` phase
   * never ran for. Without a plugin that offers one, nothing arrives. */
  feed: Feed
  /** This host shutting down, as one fact: aborted by host shutdown
   * before the last transaction and before the database is closed. A plugin
   * that arms a timer — a settle, a retry, a poll — hangs it off this signal,
   * or its callback fires into a closed store and the process is held open by
   * a timer nobody owns. The duties run under it too, so one abort
   * stops everything this process was doing on its own. */
  /** HTTP failures keep their request bundle outside this graph. */
  report?: (request: Bundle, error?: unknown) => void
  stopping: AbortSignal
}
