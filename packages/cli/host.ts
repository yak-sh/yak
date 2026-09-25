/**
 * The graph a config file names, opened by a process for the roles it serves.
 *
 * A plugin says what it contributes, one facet per subpath: the components and
 * tools it declares (`@yaks/mail/vocab`), what a write means (`/rules`), the
 * functions behind its tools (`/tools`), what runs after a commit
 * (`/effects`), the work it keeps doing while a process is up (`/service`), the
 * HTTP it adds (`/routes`), and how its entities are drawn (`/views`, `/tui`).
 * It never says where any of that runs. A process serves roles, and imports
 * only the facets of the roles it serves:
 *
 * ```
 * graph       vocab, rules, tools   open the file, admit writes, run tool calls
 * web         routes                the HTTP a listener answers with
 * effects     effects               the code behind the effects a commit owes
 * @yaks/mail  that plugin's service the timer or poll one plugin keeps up
 * ```
 *
 * The first three are {@link ROLES}, which every graph has; a plugin with a
 * `./service` brings a role of its own, named by its package. The config names
 * the plugins; each process picks its roles. `yak serve` serves `web`, the
 * role @yaks/api's `serve` declares. A `yak` command serves commands and
 * rendering, which are its own (./run.ts, ./answer.ts), and reaches the graph
 * either through a server or by composing the graph role here itself
 * (local.ts). A role this process does not serve costs it nothing: its facets
 * are never imported, so a command that opens the graph to read it never loads
 * a line of HTTP, and a process that serves no `web` never asks a plugin for a
 * route.
 *
 * {@link compose} is the one place a graph is assembled: it imports the facets,
 * opens one SQLite file, builds the graph over the plugins' rules, and wires in
 * what the other roles bring. A subpath a package does not export is skipped;
 * one that exists and fails to import is an error, never a skip. Nothing here
 * binds a port: `serve`, declared and implemented by
 * {@link https://jsr.io/@yaks/api | @yaks/api}, listens with the
 * {@link Host.handler} built here, and only a config naming @yaks/api has one.
 *
 * ```ts
 * import { compose } from '@yaks/cli/host'
 *
 * // let config = { db: 'graph.db', plugins: ['@yaks/task'] }
 * // let host = await compose(config, ['graph'])
 * // console.log(await host.graph.read('.task'))
 * ```
 *
 * @module
 */

import {
  type Actor,
  type Comp,
  detached,
  type Eid,
  type Graph,
  graph,
  type NamedTool,
  type Plugin,
  toolName,
} from '@yaks/graph'
import { type Runner, runner, toolsDoc } from '@yaks/tools'
import { loadTools, type Runs, type Search, tier } from '@yaks/graph/tools'
import { toolsIn } from '@yaks/vocab/tools'
import {
  effectsIn,
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { ended, PROCESS, selfEid, started } from '@yaks/process'
import type { Derived, Driver, Extension } from '@yaks/sql'
import { migrations, storage, type Store } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
// Types only. A route and a request handler are @yaks/api's words, and a host
// names the shape of what it passes through without importing a line of HTTP:
// the package that answers requests is a plugin a config lists, never a
// dependency of this one.
import type { Authenticate, Handler, Route } from '@yaks/api'
import { adopt, fields as searched, find, search } from '@yaks/fts'
import {
  type Effects,
  effects,
  type Handlers,
  HOLD,
  holding,
  released,
} from '@yaks/effects'
import { type Local, peek, warm } from '@yaks/secrets'
import { type Blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import { type Config, given, type Options, subpath, used } from './config.ts'
import { stateDir } from './store.ts'
import { understood } from './keywords.ts'
import { vaultOf } from './vault.ts'

export {
  type Config,
  configPath,
  given,
  type Options,
  type Plug,
  read,
  used,
} from './config.ts'

/** What every plugin factory is handed: the graph being assembled, the
 * vocabulary of components and tools it holds, the store under it, the
 * database connection beneath that, and the config that named them. `storage`,
 * `graph`, `handler`, `runner` and `duties` are live from the moment each is
 * built — a factory may keep a reference and must not call it before it
 * returns, since an `extend` factory runs before there is a store to read and
 * a `runs` factory is asked for its tools before there is a runner to run
 * them. */
export type Host = {
  config: Config
  /** the roles this process serves over the graph ({@link ROLES}): the
   * facets it imported, and so what else is wired in below */
  roles: readonly Role[]
  vocab: Vocab
  storage: Store
  sql: Driver
  /** where this graph's secrets are kept (./vault.ts): private files beside
   * its database, or memory for a graph in memory — what @yaks/secrets seals
   * into and a config's `{"secret": "NAME"}` is read from */
  vault: Local
  /** where this graph keeps content-addressed text and bytes (@yaks/blob): a
   * table in its own database — what a `store: blob` property is written to,
   * and where @yaks/page keeps an archived page unless it names a directory */
  blobs: Blobs
  /** where this program keeps what it remembers between commands on this
   * machine (./store.ts `stateDir`): a plugin remembering something for the
   * next command keeps it there */
  state: string
  /** every property the store reads through an expression rather than as
   * stored, keyed `comp.prop` — a @yaks/blob body resolves its address to its
   * text — so a plugin reading SQL directly reads what the store reads */
  derived: Derived
  graph: Graph
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
  routes: Route[]
  /** every tool declared across the plugins, joined to the code behind it,
   * with this graph's own generic tier (@yaks/graph `tier`) first. One list: a
   * command line runs it, and a transport that lists tools lists it. */
  tools: NamedTool[]
  /** ranked text search over this graph, where its vocabulary marks a property
   * `search: true` and @yaks/fts indexed it — what the tier's `search` tool
   * answers with, and what a transport restating the tier asks for. */
  search?: Search
  /** the one tool runner over this graph: what writes a `call` row, runs the
   * function and writes the result back, for a command line and an HTTP
   * request alike. */
  runner: Runner
  /** The work this process does that nobody asked for: the effect pool where
   * it serves `effects` (@yaks/effects `work` — any number of processes work
   * it at once), and each plugin's `./service` where it serves that plugin.
   * A service is taken under a lease named for its package (@yaks/effects
   * `holding`), so of all the processes over one graph exactly one is running
   * each — a second long-running process waits, and takes over when a killed
   * holder's lease expires.
   *
   * Runs until `signal` aborts; left out, that signal is this host's own, so
   * it stops with {@link Served.close}. Pass an already-aborted signal for one
   * pass each and no waiting, which is what a one-shot command does on its way
   * in — and it works no effects at all where a process that stays up is
   * working them — and the live form is what a process that stays up calls. */
  duties: (signal?: AbortSignal) => Promise<void>

  /** This process, as an entity (@yaks/process `started`): the row it wrote on
   * the way in, what everything it writes is attributed to, and what a
   * start-up effect compares against to tell its own creation from a child
   * process's. */
  me: Eid
  /** who is calling — the answer every door over this graph gets, a command
   * line and @yaks/api's endpoints alike, so what a caller writes is
   * attributed to it (`signed` in @yaks/api) instead of to nobody. At most one
   * plugin answers it ({@link RulesFacet.authenticate}); where it names
   * nobody, the answer is this host process itself ({@link writer}). */
  who: Authenticate
  /** This host shutting down, as one fact: aborted by {@link Served.close}
   * before the last transaction and before the database is closed. A plugin
   * that arms a timer — a settle, a retry, a poll — hangs it off this signal,
   * or its callback fires into a closed store and the process is held open by
   * a timer nobody owns. The duties run under it too, so one abort
   * stops everything this process was doing on its own. */
  stopping: AbortSignal
}

/** The roles every graph has, and the facet each one imports from every
 * plugin. A plugin with a `./service` brings one role more, named by its
 * package, which imports that one facet of that one plugin. Rendering is not
 * among them: drawing an entity is the caller's, the web UI's or the `yak`
 * command's (./answer.ts), and needs no graph open. */
export let ROLES = {
  graph: ['vocab', 'rules', 'tools'],
  web: ['routes'],
  effects: ['effects'],
} as const

/** A role: one of {@link ROLES}, or a plugin's package, for its service. */
export type Role = string

/** Every subpath a role imports. */
export type FacetName = typeof ROLES[keyof typeof ROLES][number] | 'service'

/** Every role a config's graph has: the three every graph has, and one per
 * plugin for its service (a plugin with none brings nothing to it). */
export let every = (config: Config): Role[] => [
  ...Object.keys(ROLES),
  ...(config.plugins ?? []).map(used),
]

// Whether a role is one every graph has, rather than a plugin's service.
let common = (role: Role): role is keyof typeof ROLES =>
  Object.hasOwn(ROLES, role)

/** `<plugin>/vocab` — what the plugin declares, and nothing that could not
 * run in a browser tab: a page importing this must never reach SQL, a database
 * driver or a server runtime. */
export type VocabFacet = {
  /** the components and tools this plugin declares */
  docs?: VocabDoc[]
  /** the JSON Schema keywords those documents use (@yaks/vocab `loadVocab`) */
  keywords?: Keywords[]
  /** properties the store computes rather than stores, written as SQL */
  derived?: (vocab: Vocab) => Derived
}

/** `<plugin>/rules` — what a write means, what a query may ask for, and who
 * is writing. `rules` runs while the host is being assembled and may create
 * tables of its own through `host.sql`; `extend` contributes the clause
 * compilers every read path consults (@yaks/sql `Extension`), which is how a
 * package holding an index of its own — a text search, a vector, a link table
 * — can answer a clause the compiler would otherwise reject.
 *
 * `authenticate` names the caller behind a request, for every door over this
 * graph: a command line asks it about the session it speaks for exactly as an
 * HTTP request is asked (local.ts `signer`), so it belongs to the graph role
 * rather than to the routes. It is a factory like every other plugin export,
 * because naming a caller is a read: @yaks/session resolves a request to the
 * session it claims to speak for, which it can only do through the host's own
 * graph. It is handed the host with nothing open on it yet — keep the
 * reference, do not call it. At most one plugin may export it. */
export type RulesFacet = {
  rules?: (host: Host, options: Options) => Plugin[]
  extend?: (host: Host, options: Options) => Extension[]
  authenticate?: (host: Host, options: Options) => Authenticate
}

/** `<plugin>/tools` — the functions behind its `tool: true` declarations,
 * keyed by tool name.
 *
 * A factory, like every other plugin export, because a tool function needs the
 * same things the others do: a check over a package's own SQL table reaches it
 * through `host.sql` (@yaks/sqlite's storage scan, @yaks/embedding's vector
 * index), and a threshold or a relation name belongs in the config, not the
 * code. What a tool function is handed per call — the graph, the caller, the
 * arguments — still arrives on the tool context. */
export type ToolsFacet = { runs?: (host: Host, options: Options) => Runs }

/** `<plugin>/effects` — the code behind the effects this plugin's vocabulary
 * declares (`effect: true`), keyed by the name each is declared under. A mail
 * sender, a process launcher: what an effect acts on is named in this
 * plugin's options, and a declared effect this config gives no code has
 * nothing to do here — its runs are settled as done. */
export type EffectsFacet = {
  effects?: (host: Host, options: Options) => Handlers
}

// What a declared effect does where this config gives it no code.
let nothing: Handlers[string] = () => {}

// A plugin's `./effects` handling a name its vocabulary never declares: code
// that would never run, since nothing owes it.
let undeclared = (plugin: string, name: string) =>
  new Error(`${plugin} handles ${name}, which it never declares`)

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
  rules: RulesFacet
  tools: ToolsFacet
  effects: EffectsFacet
  routes: RoutesFacet
  service: ServiceFacet
}

/** How one of a plugin's subpaths becomes a module. `null` means the package
 * does not export that subpath. Injectable, so a test can assemble a host from
 * modules it wrote inline rather than files on disk. */
export type Load = <F extends FacetName>(
  plugin: string,
  facet: F,
) => Promise<Facets[F] | null>

/** The default {@link Load}: {@link subpath}. */
export let facet: Load = (plugin, name) => subpath(plugin, name)

/** An assembled host: everything a plugin factory was given, plus what only
 * the caller of {@link compose} needs. */
export type Served = Host & {
  /** close the graph: every lease this process holds released and its `exit`
   * stamped — with the code it is given, or with none where nobody knows how
   * it ended. Await it when the process is about to end, or that last write
   * races the exit and the row reads as still running forever. */
  close: (code?: number) => void | Promise<void>
}

/** The database a config names. `DB_PATH` is the other way to give it, for a
 * service file that would rather set it in the environment. Neither has a
 * default, because the path anybody would pick as one is somebody's live
 * graph. */
export let dbOf = (
  config: Config,
  env: (name: string) => string | undefined = (n) => Deno.env.get(n),
): string => {
  let db = config.db ?? env('DB_PATH')
  if (!db) {
    throw new Error(
      'a host needs a database: `db` in the config, or DB_PATH in the ' +
        'environment — there is no default',
    )
  }
  return db
}

// The plugins' declarations, plus the components a tool call is recorded in
// where no plugin declared them. Declaring one component twice is an error
// (@yaks/vocab), and rightly — two definitions of one component is not
// something to guess about — so what is added here is only the difference,
// never a second copy.
let said = (docs: VocabDoc[]): VocabDoc[] => {
  let taken = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  let $defs = Object.fromEntries(
    Object.entries(toolsDoc.$defs ?? {}).filter(([name]) => !taken.has(name)),
  )
  return Object.keys($defs).length
    ? [{ title: 'invocation', package: '@yaks/tools', $defs }, ...docs]
    : docs
}

// The name in `{"secret": "NAME"}`, when the object holds nothing else.
let secretIn = (value: unknown): string | undefined => {
  let said = value as Record<string, unknown> | null
  return said && typeof said == 'object' && typeof said.secret == 'string' &&
      Object.keys(said).length == 1
    ? said.secret
    : undefined
}

// Every secret a plugin's options name, wherever in them it sits.
let bound = (value: unknown): string[] => {
  let name = secretIn(value)
  if (name) return [name]
  return value && typeof value == 'object'
    ? Object.values(value).flatMap(bound)
    : []
}

// `{"secret": "NAME"}` anywhere in a plugin's options reads that secret at the
// moment the value is accessed (@yaks/secrets `peek`): the value written
// through the graph, the 1Password value it is bound to, or else the
// environment variable of that name. It is the one thing a config file cannot
// hold in the open, and the one thing that can arrive after the host is
// already running, so a plugin that re-reads its options on each pass starts
// the moment a key is written rather than needing a restart. A secret nobody
// has provided reads as undefined rather than as a guess, so the plugin
// reports in its own words what it is waiting for.
let revealing = (value: unknown, vault: Local): unknown => {
  let name = secretIn(value)
  // A whole options object written `{"secret": …}` has no parent object to
  // define a getter on, so it is read here, once.
  if (name) return peek(vault, name)
  if (!value || typeof value != 'object') return value
  let out = (Array.isArray(value) ? [] : {}) as Record<string, unknown>
  for (let [k, v] of Object.entries(value)) {
    let said = secretIn(v)
    if (said) {
      Object.defineProperty(out, k, {
        get: () => peek(vault, said),
        enumerable: true,
        configurable: true,
      })
    } else out[k] = revealing(v, vault)
  }
  return out
}

/**
 * Who a host writes as when no request named a caller: this PROCESS, acting
 * for itself through itself.
 *
 * There is no configured actor name. A run of a program is not a singleton and
 * never was — two `yak` commands and a `yak serve` over one file are three
 * writers — so the identity is the `process` row this run wrote on the way in
 * (@yaks/process `started`). That makes `created.by` the answer to *which run*
 * wrote a thing, and lets a child process's row, written by its parent, record
 * whose child it is without needing a property for it.
 *
 * A graph whose vocabulary has no `process` component has no such row, and
 * writes go unattributed rather than attributed to an id nothing created.
 */
export let writer = (vocab: Vocab): Actor | null =>
  vocab.comp(PROCESS) ? { by: selfEid(), via: selfEid() } : null

// At most one plugin may name the caller; two would mean the answer depends on
// import order, which is not an answer. Whoever it is, this PROCESS is the
// fallback: a request no plugin claimed is this machine's own writing, not
// nobody's.
let doorman = (
  ruled: [RulesFacet, Options, string][],
  host: Host,
  self: Actor | null,
): Authenticate => {
  let said = ruled.filter(([r]) => r.authenticate)
  if (said.length > 1) {
    throw new Error(`${said.length} plugins authenticate — a door has one`)
  }
  let [mod, options] = said[0] ?? []
  let ask = mod?.authenticate?.(host, options ?? {})
  return ask ? async (request) => (await ask(request)) ?? self : () => self
}

// One facet of every plugin a config names, each beside the options it was
// named with and the package it came from: what a process runs is one plugin's
// module handed one plugin's config. The package comes third, because a duty's
// lease is named after the package that owns the work — the lease `@yaks/wake`
// holds is the one every process reaching for that timer reaches for.
type Taken<F extends FacetName> = [Facets[F], Options, string][]

let taking = async <F extends FacetName>(
  plugins: [string, Options][],
  name: F,
  load: Load,
): Promise<Taken<F>> =>
  (await Promise.all(
    plugins.map(async ([plugin, options]) =>
      [await load(plugin, name), options, plugin] as const
    ),
  )).filter((t): t is [Facets[F], Options, string] => !!t[0])

/** What a config's plugins declare, read without opening anything: their
 * vocabulary documents (each written with the package that brought it), the
 * vocabulary they load into, and the tools they declare. What a command line
 * lists, and what a graph is then built over. */
export type Words = {
  docs: VocabDoc[]
  vocab: Vocab
  /** the properties the store computes rather than stores */
  derived: Derived
  /** the tools the graph these words describe offers, declared and not
   * implemented: the generic tier where the vocabulary gives it one, then every
   * plugin's */
  tools: () => Declared[]
}

/** A tool as declared, without the code behind it. */
export type Declared = Omit<NamedTool, 'run'>

// The words, from the `./vocab` facets already imported.
let wordsOf = (vocabs: Taken<'vocab'>): Words => {
  // The components a tool call is recorded in belong to the host, not to
  // whichever plugin happened to declare them: what was asked of this host is
  // its own record. A plugin that already declares them — a harness, whose
  // transcripts are calls — keeps its own definitions, so only the components
  // nobody supplied are added.
  let docs = said(
    vocabs.flatMap(([v, , plugin]) =>
      (v.docs ?? []).map((d) => ({ ...d, package: plugin }))
    ),
  )
  let vocab = loadVocab(
    docs,
    understood(vocabs.flatMap(([v]) => v.keywords ?? [])),
  )
  return {
    docs,
    vocab,
    derived: Object.assign({}, ...vocabs.map(([v]) => v.derived?.(vocab))),
    // The generic tier lists `search` only where a property is indexed, so its
    // declarations are read off the tier the graph would build. Read on asking,
    // since checking every declaration costs what a graph opened to answer one
    // query should not pay twice.
    tools: () => [
      ...tier({
        keywords: vocab.keywords,
        ...(searched(vocab).length ? { search: () => [] } : {}),
      }).map(({ run: _, ...decl }) => decl),
      ...toolsIn(docs).map((decl) => ({
        ...decl,
        name: decl.name ?? toolName(decl),
      })),
    ],
  }
}

// Each plugin a config names, with its options, a secret among them read when
// accessed.
let named = (config: Config, vault?: Local): [string, Options][] =>
  (config.plugins ?? []).map((plug) => [
    used(plug),
    (vault ? revealing(given(plug), vault) : given(plug)) as Options,
  ])

/** The words a config's plugins declare: each one's `./vocab`, and nothing
 * else — no database opened, no rule or tool imported. */
export let words = async (
  config: Config,
  load: Load = facet,
): Promise<Words> => wordsOf(await taking(named(config), 'vocab', load))

/**
 * Open the graph a config names, for the roles this process serves: import
 * those roles' facets and nothing else, open the database, build the graph, and
 * wire in what each role brings — the code behind the effects, and the worker
 * that runs them, for `effects`; the request handler for `web`; a plugin's
 * service for the role named by its package. Every process serves `graph`,
 * since the graph is what it opened.
 *
 * `load` is how one of a plugin's subpaths becomes a module ({@link facet}).
 * It is injectable, so a test can assemble a host from modules it wrote inline
 * rather than files on disk.
 */
export let compose = async (
  config: Config,
  roles: readonly Role[],
  load: Load = facet,
): Promise<Served> => {
  if (!roles.includes('graph')) {
    throw new Error('a host opens a graph — its roles include graph')
  }
  let path = dbOf(config)
  // Where this graph's secrets are kept (./vault.ts), and each secret an
  // option names read once now, so the option has it the first time a factory
  // looks. Only those: a secret code reads at the moment it is used (`reveal`)
  // is fetched then, and a command does not wait on 1Password for it.
  let vault = vaultOf(path)
  await warm(vault, (config.plugins ?? []).flatMap((p) => bound(given(p))))
  let plugins = named(config, vault)
  // A service role names a plugin, so it has to be one the config lists.
  let services = roles.filter((r) => !common(r))
  for (let r of services) {
    if (!plugins.some(([p]) => p == r)) {
      throw new Error(`no plugin ${r} in this config serves that role`)
    }
  }
  // Only the facets of the roles served. A role not served is a facet never
  // imported, so an empty list stands for it. The graph's `./tools` is not
  // among them: a plugin's tools are declared by its vocabulary, and its code
  // is imported by the first call of one of them — a command runs one tool,
  // and most of the plugins' code is for tools it will not run.
  let take = <F extends FacetName>(role: Role, name: F): Promise<Taken<F>> =>
    roles.includes(role) ? taking(plugins, name, load) : Promise.resolve([])
  let [vocabs, ruled, watched, served, running] = await Promise.all([
    take('graph', 'vocab'),
    take('graph', 'rules'),
    take('effects', 'effects'),
    take('web', 'routes'),
    taking(plugins.filter(([p]) => services.includes(p)), 'service', load),
  ])
  let { vocab, derived } = wordsOf(vocabs)

  let sql = open(path)
  try {
    migrations(sql).ready()
    for (let statement of blobSchema()) sql.query(statement)
    let store: Store | undefined
    // Search is a property of the declaration: a property marked `search: true`
    // is indexed, whoever declared it, so wiring @yaks/fts here rather than in
    // a plugin is what takes the vocabulary at its word. Two things follow
    // from that one list of properties — a bare word in any query compiles to a
    // text match (one more clause compiler beside the plugins'), and `/mcp`
    // lists a ranked `search` tool.
    let text = searched(vocab)

    let g: Graph | undefined
    // Built further down, once the plugins have said what they contribute, and
    // reached through the host by the facets that need them: `@yaks/api`'s
    // `serve` is a tool, so it is asked for at a moment when the handler it
    // listens with does not exist yet, and reads it off the host when the call
    // arrives. The routes and the tools are the same story one step earlier —
    // a plugin that hosts routes, or mounts one, reads both off the host while
    // it is being assembled.
    let answering: Handler | undefined
    let paths: Route[] = []
    let made: NamedTool[] | undefined
    let ranked: Search | undefined
    let calls: Runner | undefined
    let watching: Effects | undefined
    let doing: ((signal?: AbortSignal) => Promise<void>) | undefined
    let stopping = new AbortController()
    // Who is calling is settled before anything is built: a plugin's route
    // needs the same answer @yaks/api's own endpoints get, or what it writes
    // is attributed to nobody while `/apply` beside it is attributed
    // correctly. The host process itself is that answer until the plugins are
    // asked, which happens a moment later — `who` reads the variable rather
    // than a copy of its value.
    let self = writer(vocab)
    let authenticate: Authenticate = () => self
    let host: Host = {
      config,
      roles,
      vocab,
      sql,
      vault,
      blobs: sqliteBlobs(sql),
      state: stateDir(),
      derived,
      me: selfEid(),
      who: (request) => authenticate(request),
      stopping: stopping.signal,
      get storage(): Store {
        if (!store) throw new Error('the store is not open yet')
        return store
      },
      get graph(): Graph {
        if (!g) throw new Error('the graph is not open yet')
        return g
      },
      get handler(): Handler | undefined {
        return answering
      },
      get routes(): Route[] {
        return paths
      },
      get tools(): NamedTool[] {
        if (!made) throw new Error('the tools are not built yet')
        return made
      },
      get search(): Search | undefined {
        return ranked
      },
      get fx(): Effects {
        if (!watching) throw new Error('the effects are not built yet')
        return watching
      },
      get runner(): Runner {
        if (!calls) throw new Error('the tool runner is not built yet')
        return calls
      },
      duties: (signal) => {
        if (!doing) throw new Error('the duties are not built yet')
        return doing(signal)
      },
    }
    authenticate = doorman(ruled, host, self)
    // The clause compilers belong to the store, so they are gathered before it
    // is built: what a query may ask for is settled once, while the host is
    // assembled, and every read path — `/query`, `/ws`, a tool, the command
    // line — goes through them. A factory is handed the host with nothing open
    // on it yet, the same promise `graph` makes: keep the reference, do not
    // call it.
    let extend = ruled.flatMap(([r, options]) =>
      r.extend?.(host, options) ?? []
    )
    store = storage(sql, vocab, {
      derived,
      extend: text.length ? [...extend, search(text, sql)] : extend,
      number: config.numbers ?? false,
      adopt: config.adopt ?? false,
    })
    store.install()

    // The registry, in every process: the effects the plugins' vocabularies
    // declare are what a commit owes, so whatever this process writes, the
    // runs it owes are written down with it (@yaks/effects), for any process
    // working the pool — this one only if it serves `effects`. An effect
    // writes through the graph's own `apply()`, trusted: what it writes comes
    // from the host, never from a client.
    let fx = watching = effects(vocab, {
      write: (b) => host.graph.apply(b, { trusted: true }),
      owner: host.me,
    })
    g = graph({
      storage: host.storage,
      vocab,
      // A write no request attributed is the host's own: its rules, its
      // effects, its start-up passes and the bulk loads it is handed are all
      // stored attributed to this process.
      ...(self ? { actor: self } : {}),
      plugins: [
        ...ruled.flatMap(([r, options]) => r.rules?.(host, options) ?? []),
        fx,
      ],
    })
    // The code behind the plugins' effects, where this process serves
    // `effects` (their facets were never imported anywhere else). Each plugin
    // handles the effects its own vocabulary declares, and one this config
    // gives no code has nothing to do here: its runs are settled as done, not
    // left owed to a process that will never come.
    let effecting = roles.includes('effects')
    if (effecting) {
      let given = new Map(
        watched.map(([mod, options, plugin]) => [
          plugin,
          mod.effects?.(host, options) ?? {},
        ]),
      )
      for (let [v, , plugin] of vocabs) {
        let names = effectsIn(v.docs ?? []).map((e) => e.name)
        let code = given.get(plugin) ?? {}
        given.delete(plugin)
        let stray = Object.keys(code).find((n) => !names.includes(n))
        if (stray) throw undeclared(plugin, stray)
        fx.handle({
          ...Object.fromEntries(names.map((n) => [n, nothing])),
          ...code,
        })
      }
      for (let [plugin, code] of given) {
        let [stray] = Object.keys(code)
        if (stray) throw undeclared(plugin, stray)
      }
    }
    // After every table exists, the plugins' own included: a full-text index is
    // built over the tables it reads, and a property the graph stores under a
    // content address is read through the plugin's table — so the index is
    // created once the rules have installed theirs. `adopt` brings the indexes
    // into line with what the vocabulary declares and rebuilds one that
    // drifted, and writes nothing on a start where nothing changed.
    if (text.length) adopt(sql, text, derived)
    // Ranked results, for whoever asks for them. Which rows match is already
    // answered by the extension above; this is the order they come back in.
    ranked = text.length
      ? async (words, opts) => {
        let hits = find(sql, text, words, { limit: opts?.limit })
        let found = await detached(host.storage).get(hits.map((h) => h.entity))
        let at = new Map(found.map((b) => [b.entity.eid, b]))
        return hits.map((h) => at.get(h.entity)).filter((b) => !!b)
      }
      : undefined
    // The generic tools belong to this graph, not to any transport: they are
    // declared in @yaks/graph's own vocabulary and implemented there, and a
    // host has a graph whether or not anything is listening. So the tier is
    // assembled here beside the plugins' own, in the form the vocabulary
    // declares, and a transport that needs them in its own form restates them
    // (@yaks/mcp `core`).
    //
    // A plugin's own tools are listed from its vocabulary and run by its
    // `./tools`, imported the first time one of them is called.
    let tools = made = [
      ...tier({ search: ranked, keywords: vocab.keywords }),
      ...vocabs.flatMap(([v, options, plugin]) =>
        loadTools(v.docs ?? [], async () => {
          let code = await load(plugin, 'tools')
          return code?.runs?.(host, options) ?? {}
        })
      ),
    ]
    // The one tool runner over this graph. A caller runs a tool and the runner
    // records the request and the result as it goes; what the two effects
    // @yaks/tools declares add, in a process serving `effects`, is the calls
    // nobody is waiting on — one written through `/apply`, or one whose
    // scheduled wake has now fired. A call this graph has no tool for is left
    // alone for whoever does have it. The `tool` rows a call points at are
    // written on the first call and at start-up, never while assembling: a
    // one-shot command opens a host to ask one question and should not write
    // just to say hello.
    let run = calls = runner(g, {
      tools,
      // This host owns the calls it claims, so the start-up pass re-runs its
      // own interrupted calls and leaves alone another runner's, or those an
      // imported transcript recorded as already run.
      ...(self ? { owner: self.by } : {}),
      // This process, on every call it runs, for a tool that acts on the
      // machine rather than the graph: `yak land` fast-forwards the checkout
      // the person typed in, because the tool runs in the same process that
      // read the command line (local.ts). A host answering HTTP reports its
      // own, which is the accurate answer — a call arriving over HTTP acts on
      // the machine that received it.
      process: started()[PROCESS] as Comp,
      report: (err) => console.error('tool failed —', err),
    })
    if (effecting) {
      let due: Handlers[string] = (e) => run.run(e.entity.eid)
      fx.handle(Object.fromEntries(run.rules.map((r) => [r.rule.name, due])))
    }
    // Which listed plugin hosts the routes — turns them into the one handler
    // this host answers with (@yaks/api). Two would be two answers to one
    // request, which is not an answer. None means nothing here serves HTTP, so
    // the other plugins are never asked for routes: a facet whose whole
    // purpose is a listener that does not exist is a facet this host ignores.
    // `served` is empty in a process that does not serve `web`.
    let hosts = served.filter(([r]) => r.handler)
    if (hosts.length > 1) {
      throw new Error(`${hosts.length} plugins host routes — a host has one`)
    }
    let [mod, options] = hosts[0] ?? []
    if (mod?.handler) {
      paths = served.flatMap(([r, o]) => r.routes?.(host, o) ?? [])
      answering = mod.handler(host, options ?? {})
    }
    // The duties: work that is nobody's request and everybody's to do. The
    // effect pool is the `effects` role's, worked by any number of processes
    // at once; each plugin's service is the role named by its package
    // (`running` holds only those served), leased under that name so exactly
    // one process runs it. One pass, then a wait, is the shape they share: do
    // what is overdue, then keep at it until this process ends.
    let hold = config.lease ?? HOLD
    let duties: Duty[] = running.map(([mod, options, plugin]): Duty => ({
      name: plugin,
      run: (signal) => mod.service!(host, options, signal),
    }))
    // Started together and stopped together, by one signal: a host shutting
    // down is one fact, and a duty that outlived the database it
    // reads would be a crash nobody asked for. One that throws is reported
    // and that plugin's duty stops — the others keep going, the way a failing
    // effect is telemetry rather than a broken host. A config that turned
    // them off (`duties: false`, `yak --no-duties`) takes no lease, works no
    // effects and runs none of them, in either form: what it commits is left
    // written down for a process that does.
    doing = config.duties == false ? async () => {} : (signal) => {
      let until = signal ?? stopping.signal
      return Promise.all([
        ...(effecting
          ? [
            fx.work(g!, until)
              .catch((e) => console.error('effects failed —', e)),
          ]
          : []),
        ...duties.map((d) =>
          holding(g!, d.name, { holder: selfEid(), hold, signal: until }, d.run)
            .catch((e) => console.error(`duty failed — ${d.name}`, e))
        ),
      ]).then(() => {})
    }
    // This process, written in. Last in this function, because the creation of
    // this row owes what a process starting owes (@yaks/connections installs
    // what it builds), and the declarations above have to be in place when it
    // commits. First among the writes, because everything after is attributed
    // to it and `created.by` is a reference: a process attributing writes to an
    // entity nothing created would store a dangling id on its very first
    // write.
    if (self) await g.apply([started()])
    return {
      ...host,
      graph: g,
      fx,
      // The last transaction, then the file: every lease this process holds
      // released, and its ending stamped. One transaction, because they are
      // one fact — a process that is over is not doing any work, and the next
      // process to ask should not have to wait out a lease nobody is using.
      // Last, because an absent `exit` is what running means, so a process
      // that closed without stamping one reads as still running forever.
      //
      // First of all, the abort: the duties stop and every timer a
      // plugin hung off {@link Host.stopping} is cancelled, so nothing is
      // still pending over a database that is about to be closed. Then the
      // effects this process started are let finish, and it leaves the pool,
      // so what its last transaction owes is left written down for another.
      close: async (code?: number) => {
        stopping.abort()
        await fx.stop()
        let shut = () => {
          try {
            sql.close()
          } catch { /* already closed */ }
        }
        if (!self) return shut()
        try {
          await g!.apply([...await released(g!, selfEid()), ended(code)])
        } catch { /* the file is going either way */ }
        shut()
      },
    }
  } catch (error) {
    sql.close()
    throw error
  }
}
