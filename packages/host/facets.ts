/** The subpaths a plugin contributes to a composed graph. */
import type { Authenticate, Filter, Handler, Route } from '@yaks/api'
import type { Eid, Plugin } from '@yaks/graph'
import type { Backings, Derived, Extension, History, Stmt } from '@yaks/sql'
import type { Handlers } from '@yaks/effects'
import type { Reply } from '@yaks/tools'
import type { Runs } from '@yaks/graph/tools'
import type { Contributions } from '@yaks/ui'
import type { Keywords, Vocab, VocabDoc } from '@yaks/vocab'
import type { Feed, Host } from './mod.ts'
import type { Options } from './config.ts'
/** `<plugin>/vocab` — what the plugin declares, and nothing that could not
 * run in a browser tab: a page importing this must never reach SQL, a database
 * driver or a server runtime. */
export type VocabFacet = {
  /** what the plugin is: its package's own description, from its deno.json,
   * written on each of its documents beside its name */
  description?: string
  /** the components and tools this plugin declares */
  docs?: VocabDoc[]
  /** the JSON Schema keywords those documents use (@yaks/vocab `loadVocab`) */
  keywords?: Keywords[]
  /** properties the store computes rather than stores, written as SQL */
  derived?: (vocab: Vocab) => Derived
  /** the rows each computed component this plugin declares is read from
   * (@yaks/sql `Backing`), given the store's read overrides */
  backed?: (vocab: Vocab, derived: Derived) => Backings
}

/** `<plugin>/graph` — what a write means, what a query may ask for, and who
 * is writing. `schema` says, as data, the tables of its own the plugin's store
 * needs, which a writing host adds with the rest of its composed schema
 * (@yaks/sqlite `follow`); `plugins` binds hooks without changing storage. `extend` contributes the clause
 * compilers every read path consults (@yaks/sql `Extension`), which is how a
 * package holding an index of its own — a text search, a vector, a link table
 * — can answer a clause the compiler would otherwise reject.
 *
 * `authenticate` names the caller behind a request, for every door over this
 * graph: a command line asks it about the session it speaks for exactly as an
 * HTTP request is asked (the concrete host's signer), so it belongs to the graph role
 * rather than to the routes. It is a factory like every other plugin export,
 * because naming a caller is a read: @yaks/session resolves a request to the
 * session it claims to speak for, which it can only do through the host's own
 * graph. It is handed the host with nothing open on it yet — keep the
 * reference, do not call it. At most one plugin may export it. */
export type GraphFacet = {
  /** The statements creating this plugin's own tables, each of which only adds
   * what is missing; a table that stands gains the columns it lacks. */
  schema?: (host: Host, options: Options) => Stmt[]
  plugins?: (host: Host, options: Options) => Plugin[]
  /** Bundles owed to a caller beside the answer to a direct tool call. */
  reply?: (host: Host, options: Options) => Reply
  extend?: (host: Host, options: Options) => Extension[]
  /** Search a phrase by meaning through this plugin's own index. */
  meaning?: (host: Host, options: Options) => Meaning
  authenticate?: (host: Host, options: Options) => Authenticate
  /** the commits other hosts make to this store (@yaks/journal's feed) */
  feed?: (host: Host, options: Options) => Feed
  /** Whether a store this plugin writes to, configured with `options`, is
   * shaped so that only this plugin reads or writes it correctly from then
   * on. A writing host records it in the store, and a host whose config leaves
   * the plugin out refuses to open the store (./config.ts `meet`). */
  required?: (options: Options) => boolean
  /** What the store keeps every version a write replaces with, where this
   * plugin's options ask it to (@yaks/journal's versions). Asked before the
   * store is opened; at most one plugin answers. */
  history?: (options: Options) => History | undefined
}

/** A result from a plugin's meaning index, with an excerpt of its source. */
export type MeaningHit = {
  entity: Eid
  similarity: number
  excerpt: string
}

/** Words → the entities nearest them in meaning, closest first, at most
 * `limit` of them. `within` is a filter line naming the entities a hit must be
 * among; its directives are ignored. */
export type Meaning = (
  words: string,
  opts?: { limit?: number; within?: string },
) => Promise<MeaningHit[]>

/** `<plugin>/tools` — the functions behind its `tool: true` declarations,
 * keyed by tool name.
 *
 * A factory, like every other plugin export, because a tool function needs the
 * same things the others do: a check over a package's own SQL table reaches it
 * through `host.storage` (@yaks/sqlite's storage scan, @yaks/embedding's vector
 * index), and a threshold or a relation name belongs in the config, not the
 * code. What a tool function is handed per call — the graph, the caller, the
 * arguments — still arrives on the tool context. */
export type ToolsFacet = { runs?: (host: Host, options: Options) => Runs }

/** `<plugin>/effects` — the code behind effects the composed vocabulary
 * declares (`effect: true`), keyed by the name each is declared under. A mail
 * sender, a process launcher: what an effect acts on is named in this
 * plugin's options. Usually the code is the declaring plugin's own; a plugin
 * may instead handle one another declares, lending what only it has (the
 * machine a transcript's run is given, @yaks/harness). Each effect has one
 * handler, and a declared effect this process gives no code owes no run. */
export type EffectsFacet = {
  effects?: (host: Host, options: Options) => Handlers
}

/** `<plugin>/routes` — the HTTP a plugin adds, and, for the one plugin that
 * hosts them, what answers a request at all.
 *
 * `handler` is exported by at most one plugin per host; it is called last,
 * with the graph open and `host.routes` holding every listed plugin's routes,
 * and what it returns is {@link Host.handler}. @yaks/api is that plugin, so a
 * config naming it serves HTTP and a config leaving it out has a host that
 * answers no request and never asks the others for routes. */
export type RoutesFacet = {
  routes?: (host: Host, options: Options) => Route[]
  /** a check every request passes before any route answers it; a plugin's
   * word on which requests reach this host at all (@yaks/tunnel's link) */
  filter?: (host: Host, options: Options) => Filter
  handler?: (host: Host, options: Options) => Handler
}

/** One duty that exactly one process at a time runs: the lease name
 * to hold it under, and the work. `run` does at least one pass and then keeps
 * going until the signal aborts — a loop on a timer, or a single pass followed
 * by a wait — so the lease stays this process's for as long as it is up. */
export type Duty = {
  /** the lease name it is held under: the package that owns the work */
  name: string
  run: (signal: AbortSignal) => void | Promise<void>
}

/** `<plugin>/service` — the work this plugin keeps doing while a process
 * serving that plugin's role is up: a timer, a poll, a sweep. It is neither a
 * request nor what a commit owes, which is why neither `routes` nor `effects`
 * could hold it: a scheduled wake coming due, and a mailbox that has to be
 * polled, are things nobody is calling about.
 *
 * It does at least one pass and then keeps going until the signal aborts, so
 * one function serves a process of either shape: a server holds it open for as
 * long as it is up, and a one-shot command hands it a signal that has already
 * aborted and gets the single pass. Of the processes serving that role over
 * one graph, which one is doing it is settled by a lease
 * ({@link Host.duties}). */
export type ServiceFacet = {
  service?: (
    host: Host,
    options: Options,
    signal: AbortSignal,
  ) => void | Promise<void>
}

/** What each subpath a role imports is expected to export. Every field is
 * optional: a plugin exports what it has, and the host uses what it finds. */
export type Facets = {
  vocab: VocabFacet
  graph: GraphFacet
  tools: ToolsFacet
  effects: EffectsFacet
  ui: Contributions
  routes: RoutesFacet
  service: ServiceFacet
}

/** How one of a plugin's subpaths becomes a module. `null` means the package
 * does not export that subpath. Injectable, so a test can assemble a host from
 * modules it wrote inline rather than files on disk. */
export type FacetName = keyof Facets

export type Load<Extra extends object = Record<never, never>> = {
  <F extends keyof (Facets & Extra)>(
    plugin: string,
    facet: F,
  ): Promise<(Facets & Extra)[F] | null>
  /** Import exactly the selected facets in one dependency graph, if supported. */
  together?: (
    requests: readonly (readonly [string, keyof (Facets & Extra)])[],
  ) => Promise<unknown>
}
