/**
 * `yak serve` — the HTTP server over the graph a config file names, and the
 * assembly step every `yak` command shares.
 *
 * A **host** here means whichever process opened the graph: a one-shot `yak`
 * command, or a long-running `yak serve`.
 *
 * There is no server process to start. A config file names a graph, and
 * {@link compose} is what opens it: a command line calls it to run one tool in
 * its own process (local.ts) and exits, and `yak serve` calls the same
 * function and then puts `/apply`, `/query`, `/ws`, `/mcp` and the plugins'
 * own routes over the result. One SQLite file in WAL mode accepts both at
 * once, so serving HTTP is one more process rather than the process everything
 * else waits on.
 *
 * A host is not written; it is assembled. This module reads a config naming
 * plugin packages and imports six modules from each, one per subpath: the
 * components and tools it declares (`@yaks/mail/vocab`), what a write means
 * (`/rules`), the functions behind the tools an agent may call (`/tools`),
 * what runs after a commit (`/effects`), the HTTP routes it adds (`/routes`)
 * and the work it keeps doing while the host is up (`/service`). This file
 * calls those six subpaths a plugin's {@link FACETS}. A subpath a package does
 * not export is skipped; a subpath that exists and fails to import is an
 * error, never a skip. Over the plugins it opens one SQLite file and mounts
 * {@link https://jsr.io/@yaks/api | @yaks/api} at `/apply`, `/query` and
 * `/ws`, and {@link https://jsr.io/@yaks/mcp | @yaks/mcp} at `/mcp`. There is
 * no other wiring: a running server is a config file and a list of packages.
 *
 * ```ts
 * import { compose } from '@yaks/cli/serve'
 *
 * // let host = await compose({ db: 'graph.db', plugins: ['@yaks/harness/plugin'] })
 * // Deno.serve(host.handler)
 * ```
 *
 * A plugin is a package — no registry, no manifest, no activation step, and
 * nothing to implement on its main entry point. Its `exports` map names the
 * subpaths it has, and each part of the system imports only the subpath it
 * needs, so a browser loading `@yaks/task/vocab` never reaches the SQL that
 * `@yaks/task/rules` would. See {@link FACETS} and the package README.
 *
 * @module
 */

import {
  type Actor,
  type Bundle,
  detached,
  type Eid,
  type Graph,
  graph,
  isPromise,
  type NamedTool,
  namedTool,
  type Plugin,
  then,
} from '@yaks/graph'
import { reconcile, type Runner, runner, toolsDoc } from '@yaks/tools'
import { loadTools, type Runs } from '@yaks/graph/tools'
import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { ended, PROCESS, selfEid, started } from '@yaks/process'
import type { Derived, Extension } from '@yaks/sql'
import { type Driver, migrations, storage, type Store } from '@yaks/sqlite'
import { Database, driver } from '@yaks/sqlite/db'
import {
  api,
  type Authenticate,
  type Handler,
  type Route,
  routed,
} from '@yaks/api'
import { core, mcp, type Search } from '@yaks/mcp'
import { adopt, fields as searched, find, search } from '@yaks/fts'
import {
  EFFECT,
  type Effects,
  effects,
  HOLD,
  holding,
  type Ledger,
  ledger,
  released,
  sleep,
  type SweepRows,
  until,
  type Watch,
} from '@yaks/effects'
import { type Config, given, type Options, PORT, used } from './config.ts'

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
 * database connection beneath that, and the config that named them. `storage`
 * and `graph` are live from the moment each is open — a factory may keep a
 * reference and must not call it before it returns, since an `extend` factory
 * runs before there is a store to read. */
export type Host = {
  config: Config
  vocab: Vocab
  storage: Store
  sql: Driver
  graph: Graph
  /** This PROCESS, as an entity (@yaks/process `started`): the row it wrote on
   * the way in, what everything it writes is attributed to, and what a
   * start-up effect compares against to tell its own creation from a child
   * process's. */
  me: Eid
  /** who is calling — the same answer @yaks/api's own endpoints get, so a
   * plugin's route can attribute what it writes (`signed` in @yaks/api)
   * instead of writing as nobody. At most one plugin may answer it; where it
   * names nobody, the answer is this host process itself ({@link writer}). */
  who: Authenticate
  /** This host shutting down, as one fact: aborted by {@link Served.close}
   * before the last transaction and before the database is closed. A plugin
   * that arms a timer — a settle, a retry, a poll — hangs it off this signal,
   * or its callback fires into a closed store and the process is held open by
   * a timer nobody owns. The background jobs run under it too, so one abort
   * stops everything this process was doing on its own. */
  stopping: AbortSignal
}

/** The six modules a host imports from a plugin, one subpath each. `views` is
 * not among them: a renderer is the web UI's to import, never a host's. */
export let FACETS = [
  'vocab',
  'rules',
  'tools',
  'effects',
  'routes',
  'service',
] as const

/** One of those six subpath names. */
export type FacetName = typeof FACETS[number]

/** `<plugin>/vocab` — what the plugin declares, and nothing that could not
 * run in a browser tab: a page importing this must never reach SQL, a database
 * driver or a server runtime. */
export type VocabFacet = {
  /** the components and tools this plugin declares */
  docs?: VocabDoc[]
  /** the JSON Schema keywords those documents use (@yaks/vocab `loadVocab`) */
  keywords?: Keywords[]
  /** columns the store computes rather than stores, written as SQL */
  derived?: (vocab: Vocab) => Derived
}

/** `<plugin>/rules` — what a write means, and what a query may ask for.
 * `rules` runs while the host is being assembled and may create tables of its
 * own through `host.sql`; `extend` contributes the clause compilers every read
 * path consults (@yaks/sql `Extension`), which is how a package holding an
 * index of its own — a text search, a vector, a link table — can answer a
 * clause the compiler would otherwise reject. They share a subpath because
 * they share a reason: both are SQL over the host's own connection. */
export type RulesFacet = {
  rules?: (host: Host, options: Options) => Plugin[]
  extend?: (host: Host, options: Options) => Extension[]
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

/** `<plugin>/effects` — what runs after a commit. A mail sender, a process
 * launcher, a sweep: what an effect acts on is named in this plugin's
 * options. */
export type EffectsFacet = {
  effects?: (host: Host, options: Options) => Watch[]
}

/** `<plugin>/routes` — the HTTP routes it adds beside @yaks/api's own, and,
 * for at most one plugin per host, who is calling.
 *
 * `authenticate` is a factory like every other plugin export, because naming a
 * caller is a read: @yaks/session resolves a request to the session it claims
 * to speak for, which it can only do through the host's own graph. It is
 * handed the host with nothing open on it yet — keep the reference, do not
 * call it. */
export type RoutesFacet = {
  routes?: (host: Host, options: Options) => Route[]
  authenticate?: (host: Host, options: Options) => Authenticate
}

/** The name of the one background job this host owns rather than any plugin:
 * the effect sweep, which finishes what a crash left between a commit and its
 * handler, and retries what a handler could not do the first time. */
export let SWEEP = '@yaks/effects'

/** The longest the sweep sleeps between passes (ms). It already knows the
 * exact time everything it owns comes due; this cap only ensures a row written
 * by another process is picked up without waiting for a write here. */
let CAP = 60_000

/** One background job that exactly one process at a time runs: the lease name
 * to hold it under, and the work. `run` does at least one pass and then keeps
 * going until the signal aborts — a loop on a timer, or a single pass followed
 * by a wait — so the lease stays this process's for as long as it is up. */
export type Duty = {
  /** the lease name it is held under: the package that owns the work */
  name: string
  run: (signal: AbortSignal) => void | Promise<void>
}

/** `<plugin>/service` — the work this plugin keeps doing while the host is up:
 * a timer, a poll, a sweep. It is neither a request nor a post-commit
 * observation, which is why neither `routes` nor `effects` could hold it: a
 * scheduled wake coming due, and a mailbox that has to be polled, are things
 * nobody is calling about.
 *
 * It does at least one pass and then keeps going until the signal aborts, so
 * one function serves a process of either shape: an HTTP server holds it open
 * for as long as it is up, and a one-shot command hands it a signal that has
 * already aborted and gets the single pass. Which process is doing it is
 * settled by a lease ({@link Served.duties}), never by which program was
 * started. */
export type ServiceFacet = {
  service?: (
    host: Host,
    options: Options,
    signal: AbortSignal,
  ) => void | Promise<void>
}

/** What each subpath is expected to export. Every field is optional: a plugin
 * exports what it has, and the host uses what it finds. */
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

// A subpath a package does not export is a module it does not have. Anything
// else that goes wrong importing one — a syntax error, a missing dependency, a
// throw at module scope — is that module failing, and is rethrown: a host that
// quietly runs without its rules is worse than one that refuses to start.
let unexported = (error: unknown, spec: string, facet: string): boolean =>
  error instanceof TypeError &&
  (error.message.startsWith(`Unknown export './${facet}' for `) ||
    error.message == `Module not found "${spec}".`)

/** The default {@link Load}: `import('<plugin>/<subpath>')`. */
export let facet: Load = async (plugin, name) => {
  let spec = `${plugin}/${name}`
  try {
    return await import(spec)
  } catch (error) {
    if (unexported(error, spec, name)) return null
    throw error
  }
}

/** An assembled host: everything a plugin factory was given, plus what came
 * out of assembling them. */
export type Served = Host & {
  /** every tool declared and implemented across the plugins */
  tools: NamedTool[]
  /** the one thing that calls a tool function here: the HTTP endpoints and
   * the command line both write a `call` row and read the result written back
   * (@yaks/tools) */
  runner: Runner
  /** the post-commit effect registry the plugins registered on */
  fx: Effects
  /** every HTTP endpoint and route, as one request handler */
  handler: Handler
  /** Every background job this process may run: the effect sweep, and each
   * plugin's `./service`. Each is taken under a lease named for the package
   * that owns it (@yaks/effects `holding`), so of all the processes over one
   * graph exactly one is running each — a second long-running process waits,
   * and takes over when a killed holder's lease expires.
   *
   * Runs until `signal` aborts; left out, that signal is this host's own, so
   * it stops with {@link Served.close}. Pass an already-aborted signal for one
   * pass each and no waiting, which is what a one-shot command does on its way
   * in. */
  duties: (signal?: AbortSignal) => Promise<void>
  /** close the graph: every lease this process holds released and its `exit`
   * stamped — with the code it is given, or with none where nobody knows how
   * it ended. Await it when the process is about to end, or that last write
   * races the exit and the row reads as still running forever. */
  close: (code?: number) => void | Promise<void>
}

// The database a config names. `DB_PATH` is the other way to give it, for a
// service file that would rather set it in the environment. Neither has a
// default, because the path anybody would pick as one is somebody's live
// graph.
let dbOf = (config: Config): string => {
  let db = config.db ?? Deno.env.get('DB_PATH')
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
    ? [{ title: 'invocation', $defs }, ...docs]
    : docs
}

// The JSON Schema keywords that belong to the host rather than to any plugin:
// which letter an entity's id carries (`prefix`, @yaks/id) and which column is
// a name somebody may type (`by_name`, @yaks/names). Every package uses them
// in its `$vocabulary`, none registers them — and an unregistered keyword is
// silently ignored, so a host that skipped these would mint `entity.num` and
// then render `P-1` for a persona that declared `N`, having fallen back to the
// component's first letter. Minting the number and printing human-readable ids
// are both this host's doing, so registering the keywords that shape them is
// too. A plugin that supplies its own copy wins; this adds only the
// difference, never a second registration.
let understood = (brought: Keywords[]): Keywords[] => {
  let taken = new Set(brought.map((k) => k.uri))
  return [
    ...brought,
    ...[idKeywords, nameKeywords].filter((k) => !taken.has(k.uri)),
  ]
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
 * whose child it is without needing a column for it.
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
  served: [RoutesFacet, Options, string][],
  host: Host,
  self: Actor | null,
): Authenticate => {
  let said = served.filter(([r]) => r.authenticate)
  if (said.length > 1) {
    throw new Error(`${said.length} plugins authenticate — a door has one`)
  }
  let [mod, options] = said[0] ?? []
  let ask = mod?.authenticate?.(host, options ?? {})
  return ask ? async (request) => (await ask(request)) ?? self : () => self
}

/**
 * Assemble a host from a config: import the plugins, open the database, build
 * the graph, and return it with the request handler the HTTP endpoints are
 * mounted on.
 *
 * `load` is how one of a plugin's subpaths becomes a module ({@link facet}).
 * It is injectable, so a test can assemble a host from modules it wrote inline
 * rather than files on disk.
 */
export let compose = async (
  config: Config,
  load: Load = facet,
): Promise<Served> => {
  let path = dbOf(config)
  let plugins = config.plugins ?? []
  let got = await Promise.all(
    plugins.map(async (plug) =>
      [
        used(plug),
        given(plug),
        await Promise.all(FACETS.map((name) => load(used(plug), name))),
      ] as const
    ),
  )
  // A plugin that exports none of the six subpaths is a typo in the config,
  // not a plugin: fail here rather than run a host quietly missing its
  // components.
  for (let [plugin, , facets] of got) {
    if (facets.every((f) => !f)) {
      throw new Error(
        `${plugin} exports no facet — a plugin has at least one of ` +
          FACETS.map((f) => `./${f}`).join(', '),
      )
    }
  }
  // A module and the options it was named with travel together: what a host
  // runs is one plugin's module handed one plugin's config. The package
  // specifier comes third, because a background job's lease is named after the
  // package that owns the work: the lease `@yaks/wake` holds is the one every
  // process reaching for that timer reaches for.
  let taken = <F extends FacetName>(name: F): [Facets[F], Options, string][] =>
    got.map(([plugin, options, facets]) =>
      [
        facets[FACETS.indexOf(name)] as Facets[F] | null,
        options,
        plugin,
      ] as const
    ).filter((t): t is [Facets[F], Options, string] => !!t[0])

  let vocabs = taken('vocab')
  let ruled = taken('rules')
  let tooled = taken('tools')
  let watched = taken('effects')
  let served = taken('routes')
  let running = taken('service')

  // The components a tool call is recorded in belong to the host, not to
  // whichever plugin happened to declare them: what was asked of this host is
  // its own record. A plugin that already declares them — a harness, whose
  // transcripts are calls — keeps its own definitions, so only the components
  // nobody supplied are added.
  let docs = said(vocabs.flatMap(([v]) => v.docs ?? []))
  let vocab = loadVocab(
    docs,
    understood(vocabs.flatMap(([v]) => v.keywords ?? [])),
  )

  if (path != ':memory:') {
    let dir = path.slice(0, path.lastIndexOf('/'))
    if (dir) Deno.mkdirSync(dir, { recursive: true })
  }
  let db = new Database(path)
  db.exec('pragma foreign_keys = on')
  if (path != ':memory:') {
    db.exec('pragma journal_mode = wal')
    db.exec('pragma synchronous = normal')
    db.exec('pragma busy_timeout = 5000')
  }
  let sql = driver(db)
  try {
    migrations(sql).ready()
    let derived: Derived = Object.assign(
      {},
      ...vocabs.map(([v]) => v.derived?.(vocab) ?? {}),
    )
    let store: Store | undefined
    // Search is a property of the declaration: a column marked `search: true`
    // is indexed, whoever declared it, so wiring @yaks/fts here rather than in
    // a plugin is what takes the vocabulary at its word. Two things follow
    // from that one list of columns — a bare word in any query compiles to a
    // text match (one more clause compiler beside the plugins'), and `/mcp`
    // lists a ranked `search` tool.
    let text = searched(vocab)

    let g: Graph | undefined
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
      vocab,
      sql,
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
    }
    authenticate = doorman(served, host, self)
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
      extend: text.length ? [...extend, search(text)] : extend,
      number: config.numbers ?? false,
      adopt: config.adopt ?? false,
    })
    store.install()

    // The ledger, where this vocabulary declares the component for one: every
    // effect written down before it runs and marked after, so a crash between
    // the commit and the handler leaves a row the sweep finds, and a handler
    // that threw is retried on the terms its registration set. A graph with no
    // `effect` component still runs effects at most once, and stores
    // nothing.
    let log: Ledger | undefined = vocab.comp(EFFECT)
      ? ledger({ owner: host.me })
      : undefined
    // An effect writes through the graph's own `apply()`, trusted: what it
    // writes comes from the host, never from a client.
    let fx = effects(vocab, {
      write: (b) => host.graph.apply(b, { trusted: true }),
      ...(log ? { around: log.around } : {}),
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
    for (let [mod, options] of watched) {
      for (let { comp, ...watch } of mod.effects?.(host, options) ?? []) {
        fx.on(comp, watch)
      }
    }
    // After every table exists, the plugins' own included: a full-text index
    // is built over the tables it reads, and a column the graph stores under a
    // content address is read through the plugin's table — so the index is
    // created once the rules have installed theirs. `adopt` brings the indexes
    // into line with what the vocabulary declares and rebuilds one that
    // drifted, and writes nothing on a start where nothing changed.
    if (text.length) adopt(sql, text, derived)
    // Ranked results, for whoever asks for them. Which rows match is already
    // answered by the extension above; this is the order they come back in.
    let ranked: Search | undefined = text.length
      ? async (words, opts) => {
        let hits = find(sql, text, words, { limit: opts?.limit })
        let found = await detached(host.storage).get(hits.map((h) => h.entity))
        let at = new Map(found.map((b) => [b.entity.eid, b]))
        return hits.map((h) => at.get(h.entity)).filter((b) => !!b)
      }
      : undefined
    // The generic tools belong to this graph, not to the HTTP layer.
    // `graph_apply` over this graph is one tool whether a person typed it or
    // an agent requested it, so it is assembled here beside the plugins' own
    // (@yaks/mcp `core`) and `/mcp` is told not to add a second copy. That is
    // what lets a command line run every tool the MCP server lists.
    let tools = [
      ...core({ vocab, search: ranked }).map(namedTool),
      ...loadTools(
        docs,
        Object.assign(
          {},
          ...tooled.map(([t, options]) => t.runs?.(host, options) ?? {}),
        ) as Runs,
      ),
    ]
    // The one tool runner over this graph. A caller runs a tool and the runner
    // records the request and the result as it goes; what this registration
    // adds is the calls nobody here is waiting on — one written by another
    // process through `/apply`, or one whose scheduled wake has now fired.
    // Each rule is one post-commit effect registration, and a call this graph
    // has no tool for is left alone for whoever does have it. The `tool` rows
    // a call points at are written on the first call and at start-up, never
    // while assembling: a one-shot command opens a host to ask one question
    // and should not write just to say hello.
    let run = runner(g, {
      tools,
      // This host owns the calls it claims, so the start-up pass re-runs its
      // own interrupted calls and leaves alone another runner's, or those an
      // imported transcript recorded as already run.
      ...(self ? { owner: self.by } : {}),
      // This process's working directory, for a tool that acts on the machine
      // rather than the graph: `yak land` fast-forwards the checkout the
      // person typed in, because the tool runs in the same process that read
      // the command line (local.ts). A host answering HTTP reports its own
      // working directory, which is the accurate answer — a call arriving over
      // HTTP acts on the machine that received it.
      cwd: Deno.cwd(),
      report: (err) => console.error('tool failed —', err),
    })
    for (let rule of run.rules) {
      fx.on(rule.plan, (e) => run.run(e.entity.eid), { doc: rule.rule.name })
    }
    let routes = served.flatMap(([r, o]) => r.routes?.(host, o) ?? [])
    let door = api({ graph: g, authenticate: host.who })
    let agents = mcp({
      graph: g,
      authenticate: host.who,
      tools,
      core: false,
      name: config.name ?? 'yak',
    })
    let handler: Handler = (request) => {
      let path = new URL(request.url).pathname
      if (path == '/mcp') return agents(request)
      let route = routes.find((r) => routed(r, request.method, path))
      // A request no plugin route claimed goes to @yaks/api, which answers
      // `/apply`, `/query` and `/ws` and returns an error for anything else.
      return route ? route.handle(request) : door(request)
    }
    // The background jobs: work that is nobody's request and everybody's to
    // do, each leased under the name of the package that owns it. The SWEEP is
    // this host's own — a crash between the commit and the handler, and a
    // handler that threw, are exactly what the ledger and a registration's
    // `sweep` are for — and the rest are the plugins' timers. One pass, then a
    // wait, is the shape they share: do what is overdue, then hold the lease
    // until this process ends, so no second process runs it at the same
    // time.
    let hold = config.lease ?? HOLD
    let duties: Duty[] = [
      {
        name: SWEEP,
        run: async (signal) => {
          // The sweep's query is written in the graph's own query grammar, so
          // the rows are read the way everything else here reads them — and a
          // handler that declared a sweep promised to be idempotent, since
          // this re-runs work that may well have run already.
          await fx.relay(unfinished(host.graph))
          if (!log) return await until(signal)
          // Then the ledger: what a crash left between a commit and its
          // handler, and every failure whose retry backoff has elapsed. One
          // pass, then a sleep until the soonest of them is due — so an
          // already-aborted signal gets one pass including the retries that
          // are owed, and a host that stays running finishes what its handlers
          // could not.
          for (;;) {
            await log.reconcile(fx, detached(host.storage))
            if (signal.aborted) return
            let at = await log.due(detached(host.storage))
            await sleep(
              Math.min(CAP, Math.max(0, (at ?? Infinity) - Date.now())),
              signal,
            )
          }
        },
      },
      ...running.map(([mod, options, plugin]): Duty => ({
        name: plugin,
        run: (signal) => mod.service!(host, options, signal),
      })),
    ]
    // This PROCESS, written in. Last in this function, because the creation of
    // this row is what start-up work hangs off — a `created(process)` effect
    // comparing the entity against `host.me` is a plugin's one pass at start,
    // and the registrations above have to be in place before it fires. First
    // among the writes, because everything after is attributed to it and
    // `created.by` is a reference: a process attributing writes to an entity
    // nothing created would store a dangling id on its very first write.
    if (self) await g.apply([started()])
    return {
      ...host,
      graph: g,
      tools,
      runner: run,
      fx,
      handler,
      // Started together and stopped together, by one signal: a host shutting
      // down is one fact, and a background job that outlived the database it
      // reads would be a crash nobody asked for. One that throws is reported
      // and that plugin's job stops — the others keep going, the way a failing
      // effect is telemetry rather than a broken host.
      duties: (signal) =>
        Promise.all(
          duties.map((d) =>
            holding(
              g!,
              d.name,
              { holder: selfEid(), hold, signal: signal ?? stopping.signal },
              d.run,
            ).catch((e) => console.error(`duty failed — ${d.name}`, e))
          ),
        ).then(() => {}),
      // The last transaction, then the file: every lease this process holds
      // released, and its ending stamped. One transaction, because they are
      // one fact — a process that is over is not doing any work, and the next
      // process to ask should not have to wait out a lease nobody is using.
      // Last, because an absent `exit` is what running means, so a process
      // that closed without stamping one reads as still running forever.
      //
      // First of all, the abort: the background jobs stop and every timer a
      // plugin hung off {@link Host.stopping} is cancelled, so nothing is
      // still pending over a database that is about to be closed.
      close: (code?: number) => {
        stopping.abort()
        let shut = () => {
          try {
            db.close()
          } catch { /* already closed */ }
        }
        if (!self) return shut()
        try {
          let done = then(
            released(g!, selfEid()),
            (lets: Bundle[]) => g!.apply([...lets, ended(code)]),
          )
          if (!isPromise(done)) return shut()
          return done.then(shut, shut)
        } catch {
          shut()
        }
      },
    }
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * What an effect's `sweep` means here: its `pending` is a query in the graph's
 * own grammar, so the rows it selects are read the way everything else is, and
 * flattened to the `{eid, …columns}` shape a registration's handler is given
 * (@yaks/effects `relay`).
 */
export let unfinished = (g: Graph): SweepRows => (comp, pending) =>
  then(
    g.read(pending),
    (found: Bundle[]) =>
      found.map((b) => ({
        eid: b.entity?.eid,
        ...b[comp] as Record<string, unknown>,
      })),
  )

/** Serve a config: assemble the host, then listen. `onListen` is told the
 * address and the host it belongs to — assembly is finished before anything
 * binds a port.
 *
 * A plugin's own start-up work is not called from here: `compose` wrote this
 * process's row, and the `created(process)` effects on it are that pass, so
 * the agents a restart left running are picked back up whichever program
 * opened the graph. */
export let serve = async (
  config: Config,
  onListen?: (addr: Deno.NetAddr, host: Served) => void,
): Promise<{ host: Served; server: Deno.HttpServer }> => {
  let host = await compose(config)
  // Write the `tool` rows a call points at, then finish what a crash left
  // claimed and unanswered. Here rather than in `compose`, because this is the
  // server starting — a one-shot command assembles the same host and must not
  // reach into calls another process is running.
  await host.runner.ensure()
  await reconcile(host.runner)
  // And then the background jobs: the effect sweep and the plugins' timers,
  // each taken under its own lease and held for as long as this process is up
  // ({@link Served.duties}). It is the same call a one-shot command makes,
  // with a live signal instead of an aborted one — an HTTP server is not a
  // special kind of process, it is the one that stays. Not awaited: it returns
  // when the host closes.
  void host.duties()
  let server = Deno.serve({
    port: config.port ?? PORT,
    hostname: config.hostname,
    onListen: (addr) => onListen?.(addr, host),
  }, host.handler)
  return { host, server }
}
