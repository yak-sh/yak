/**
 * `yak serve` — the whole server, composed from one config file.
 *
 * A host is not written; it is COMPOSED. This module reads a config naming
 * plugin packages and imports, from each, the FACETS it runs — one subpath
 * apiece: the words it speaks (`@yaks/mail/vocab`), what a batch means
 * (`/rules`), what an agent may call (`/tools`), what happens after a commit
 * (`/effects`), the HTTP it adds (`/routes`), and the one pass it makes at
 * start-up (`/boot`) and what it keeps doing while the host is up
 * (`/service`). A subpath a package does not
 * export is a facet it does not have, and is skipped; a subpath that exists
 * and fails to import is an error, never a skip. Over that it opens one SQLite
 * file and mounts the doors —
 * {@link https://jsr.io/@yaks/api | @yaks/api} at `/apply`, `/query` and
 * `/ws`, {@link https://jsr.io/@yaks/mcp | @yaks/mcp} at `/mcp`. There is no
 * other wiring: a server is a config file and a list of modules.
 *
 * ```ts
 * import { compose } from '@yaks/cli/serve'
 *
 * // let host = await compose({ db: 'graph.db', plugins: ['@yaks/harness/plugin'] })
 * // Deno.serve(host.handler)
 * ```
 *
 * A PLUGIN is a PACKAGE — no registry, no manifest, no activation, and no
 * facet protocol on its front door. Its `exports` map names the subpaths it
 * has, and a subsystem imports only the one it needs, so a browser loading
 * `@yaks/task/vocab` never reaches the SQL that `@yaks/task/rules` would. See
 * {@link FACETS} and the package README.
 *
 * @module
 */

import {
  type Entity,
  type Graph,
  graph,
  type NamedTool,
  type Plugin,
} from '@yaks/graph'
import {
  answerOf,
  faulted,
  reconcile,
  type Runner,
  runner,
  toolEid,
  toolsDoc,
  worded,
} from '@yaks/tools'
import { loadTools, type Runs } from '@yaks/graph/tools'
import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
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
import { mcp } from '@yaks/mcp'
import { type Effects, effects, type Watch } from '@yaks/effects'
import type { Ctx, Word } from './run.ts'

/** What a config says TO one plugin: its own options, handed to each facet
 * factory beside the host. A value written `{"env": "NAME"}` is read out of
 * the environment when the file is read, so a config names a secret without
 * holding one. */
export type Options = Record<string, unknown>

/** A plugin a config names: a bare specifier, or one with options. */
export type Plug = string | { use: string; with?: Options }

/** What a config file says: where the graph lives, and what speaks over it. */
export type Config = {
  /** the SQLite file, `:memory:` for a graph that lasts as long as the
   * process. Required — a host never guesses a database. */
  db?: string
  /** the plugin modules, by import specifier. A relative one is resolved
   * against the config file itself; `{use, with}` names one with options. */
  plugins?: Plug[]
  /** what to listen on (default 8787) */
  port?: number
  /** which interface (default Deno's own) */
  hostname?: string
  /** the eid every request is signed with, where nothing authenticates —
   * a box that trusts whoever reaches it. */
  actor?: string
  /** whether the store mints human numbers beside eids (default true) */
  numbers?: boolean
  /** what the MCP door calls itself (default `yak`) */
  name?: string
}

/** What every facet factory is handed: the graph being built, the words it
 * speaks, the store under it, the connection beneath that, and the config that
 * named them. `storage` and `graph` are live from the moment each is open — a
 * factory may keep them, and may not call them before it returns, since an
 * `extend` factory runs before there is a store to read. */
export type Host = {
  config: Config
  vocab: Vocab
  storage: Store
  sql: Driver
  graph: Graph
  /** who is calling — the same answer the graph's own doors get, so a route
   * signs what it writes (`signed` in @yaks/api) rather than writing as
   * nobody. One plugin may say it; where none does, it is the config's
   * `actor`. */
  who: Authenticate
}

/** The facets a host takes from a plugin, one subpath each. `views` is not
 * among them: a renderer is the WEB door's to import, never a server's. */
export let FACETS = [
  'vocab',
  'rules',
  'tools',
  'effects',
  'routes',
  'boot',
  'service',
] as const

/** One of those names. */
export type FacetName = typeof FACETS[number]

/** `<plugin>/vocab` — the words, and nothing that could not run in a browser
 * tab: a page importing this must never reach SQL, a driver or a runtime. */
export type VocabFacet = {
  /** the components and tools this plugin declares */
  docs?: VocabDoc[]
  /** JSON Schema keywords those documents use (@yaks/vocab `loadVocab`) */
  keywords?: Keywords[]
  /** columns the store computes rather than keeps, said in SQL */
  derived?: (vocab: Vocab) => Derived
}

/** `<plugin>/rules` — what a batch MEANS, and what a QUERY may say. `rules`
 * runs at compose time and may install tables of its own through `host.sql`;
 * `extend` contributes the clause compilers the READ door consults (@yaks/sql
 * `Extension`), which is how a package holding an index of its own — a search,
 * a vector, a link table — answers a clause the compiler declines alone. They
 * share a subpath because they share a reason: both are SQL over the host's
 * own connection. */
export type RulesFacet = {
  rules?: (host: Host, options: Options) => Plugin[]
  extend?: (host: Host, options: Options) => Extension[]
}

/** `<plugin>/tools` — the runs behind its `tool: true` declarations, keyed by
 * tool name. */
export type ToolsFacet = { runs?: Runs }

/** `<plugin>/effects` — what happens after a commit. A sender, a spawner, a
 * sweep: what an effect ACTS on is named in this plugin's options. */
export type EffectsFacet = {
  effects?: (host: Host, options: Options) => Watch[]
}

/** `<plugin>/routes` — the HTTP it adds beside the doors, and, for at most one
 * plugin in a host, who is calling. */
export type RoutesFacet = {
  routes?: (host: Host, options: Options) => Route[]
  authenticate?: Authenticate
}

/** `<plugin>/boot` — the one pass this plugin makes at start-up, before
 * anything is served: the leases a dead holder left, the processes a restart
 * has to adopt back. A MOMENT rather than an observation, which is why it is
 * not an effect — and why `compose` only imports it while {@link serve} is
 * what runs it: a one-shot command opens the same host to ask one question and
 * must not reconcile another process's world. */
export type BootFacet = {
  boot?: (host: Host, options: Options) => void | Promise<void>
}

/** `<plugin>/service` — the work this plugin KEEPS DOING while the host is up:
 * a clock, a poll, a sweep. Neither a request nor a post-commit observation,
 * which is why neither `routes` nor `effects` could hold it — a wake that
 * comes due and a mailbox that has to be asked are things nobody is calling
 * about. It is handed an `AbortSignal` and returns when that signal aborts;
 * `compose` imports it and {@link serve} is what starts it, for the reason
 * `boot` has: a one-shot command opens the same host to ask one question and
 * must not start another process's clock. */
export type ServiceFacet = {
  service?: (
    host: Host,
    options: Options,
    signal: AbortSignal,
  ) => void | Promise<void>
}

/** What each subpath is expected to export. Every field is optional: a plugin
 * exports what it has, and the host takes what it runs. */
export type Facets = {
  vocab: VocabFacet
  rules: RulesFacet
  tools: ToolsFacet
  effects: EffectsFacet
  routes: RoutesFacet
  boot: BootFacet
  service: ServiceFacet
}

/** How a plugin's facet becomes a module. `null` means the package does not
 * export that subpath — injected so a test composes facets it wrote in place
 * rather than files on disk. */
export type Load = <F extends FacetName>(
  plugin: string,
  facet: F,
) => Promise<Facets[F] | null>

// A subpath a package does not export is a facet it does not have. Anything
// else that goes wrong importing one — a syntax error, a dependency that is
// not there, a throw at module scope — is that facet FAILING, and is rethrown:
// a server that quietly runs without its rules is worse than one that refuses
// to start.
let unexported = (error: unknown, spec: string, facet: string): boolean =>
  error instanceof TypeError &&
  (error.message.startsWith(`Unknown export './${facet}' for `) ||
    error.message == `Module not found "${spec}".`)

/** The default {@link Load}: `import('<plugin>/<facet>')`. */
export let facet: Load = async (plugin, name) => {
  let spec = `${plugin}/${name}`
  try {
    return await import(spec)
  } catch (error) {
    if (unexported(error, spec, name)) return null
    throw error
  }
}

/** A composed host: everything a facet was given, plus what came out. */
export type Served = Host & {
  /** every tool declared and implemented across the modules */
  tools: NamedTool[]
  /** the one thing that calls a tool function here: the doors and the command
   * line both write a CALL and read what answered it (@yaks/tools) */
  runner: Runner
  /** the post-commit registry the modules registered on */
  fx: Effects
  /** the doors, as one request handler */
  handler: Handler
  /** each plugin's start-up pass, in config order — run by {@link serve}
   * before it listens, and by nobody else */
  boot: () => Promise<void>
  /** start every plugin's long-running work; it stops with {@link Served.close} */
  start: () => void
  close: () => void
}

// A specifier the config file owns — `./plugins/mail`, `/srv/mail` — is
// resolved against the config, so a config is movable and a bare `@yaks/…` is
// left to the import map. It names a PACKAGE, never a file: the facets are its
// subpaths, and only a package has those.
let near = (spec: string, base: URL): string =>
  spec.startsWith('.') || spec.startsWith('/') ? new URL(spec, base).href : spec

/** What a plugin entry names, either way it is written. */
export let used = (plug: Plug): string =>
  typeof plug == 'string' ? plug : plug.use

/** What it was given, either way it is written. */
export let given = (plug: Plug): Options =>
  typeof plug == 'string' ? {} : plug.with ?? {}

// `{"env": "NAME"}` anywhere in an options object is the environment's value
// at the moment the config is read — the one thing a config file cannot hold
// in the open. A name nothing exports reads as undefined rather than as a
// guess, so the plugin refuses in its own words about what it wanted.
let sourced = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sourced)
  if (!value || typeof value != 'object') return value
  let said = value as Record<string, unknown>
  if (typeof said.env == 'string' && Object.keys(said).length == 1) {
    return Deno.env.get(said.env)
  }
  return Object.fromEntries(
    Object.entries(said).map(([k, v]) => [k, sourced(v)]),
  )
}

let resolved = (plug: Plug, base: URL): Plug =>
  typeof plug == 'string' ? near(plug, base) : {
    use: near(plug.use, base),
    ...plug.with ? { with: sourced(plug.with) as Options } : {},
  }

/**
 * Read a config file. Paths inside it — the database, a relative plugin — are
 * resolved against the file itself.
 */
export let read = (path: string): Config => {
  let base = new URL(path, `file://${Deno.cwd()}/`)
  let said: unknown
  try {
    said = JSON.parse(Deno.readTextFileSync(base))
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`)
  }
  if (!said || typeof said != 'object' || Array.isArray(said)) {
    throw new Error(`${path}: a config is a JSON object`)
  }
  let config = said as Config
  return {
    ...config,
    db: config.db && config.db != ':memory:'
      ? new URL(config.db, base).pathname
      : config.db,
    plugins: (config.plugins ?? []).map((plug) => resolved(plug, base)),
  }
}

// The database a config names. `DB_PATH` is the other spelling, for a service
// file that would rather say it in the environment; neither defaults, because
// the default anybody would pick is somebody's live graph.
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

// The plugins' words, with the invocation's own added where they are missing.
// A word declared twice is a refusal (@yaks/vocab), and rightly — two
// spellings of one component is not something to guess about — so what is
// added here is the difference, never a second copy.
let said = (docs: VocabDoc[]): VocabDoc[] => {
  let taken = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  let $defs = Object.fromEntries(
    Object.entries(toolsDoc.$defs ?? {}).filter(([name]) => !taken.has(name)),
  )
  return Object.keys($defs).length
    ? [{ title: 'invocation', $defs }, ...docs]
    : docs
}

// Exactly one plugin may say who is calling; two would mean the door's answer
// depends on import order, which is not an answer.
let doorman = (mods: RoutesFacet[], config: Config): Authenticate => {
  let said = mods.map((m) => m.authenticate).filter((a) => !!a)
  if (said.length > 1) {
    throw new Error(`${said.length} plugins authenticate — a door has one`)
  }
  if (said[0]) return said[0]
  let actor: Entity | null = config.actor ? { eid: config.actor } : null
  return () => actor
}

/**
 * Compose a host from a config: import the plugins, open the database, build
 * the graph, and answer with the handler the doors are mounted on.
 *
 * `load` is how one plugin's facet becomes a module ({@link facet}), injected
 * so a test composes facets it wrote in place rather than files on disk.
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
  // A plugin that exports none of the five is a typo in the config, not a
  // plugin: say so here rather than serve a host quietly missing its words.
  for (let [plugin, , facets] of got) {
    if (facets.every((f) => !f)) {
      throw new Error(
        `${plugin} exports no facet — a plugin has at least one of ` +
          FACETS.map((f) => `./${f}`).join(', '),
      )
    }
  }
  // A facet and the options it was named with travel together: what a host
  // runs is one plugin's module handed one plugin's config.
  let taken = <F extends FacetName>(name: F): [Facets[F], Options][] =>
    got.map(([, options, facets]) =>
      [facets[FACETS.indexOf(name)] as Facets[F] | null, options] as const
    ).filter((pair): pair is [Facets[F], Options] => !!pair[0])

  let vocabs = taken('vocab')
  let ruled = taken('rules')
  let tooled = taken('tools')
  let watched = taken('effects')
  let served = taken('routes')
  let booted = taken('boot')
  let running = taken('service')

  // The words an invocation is written in come with the HOST, not with
  // whichever plugin happened to mention them: what was asked of this server
  // is its own transcript. A plugin that speaks them already — a harness,
  // whose transcripts ARE calls — keeps its own spelling, so only the words
  // nobody supplied are added.
  let docs = said(vocabs.flatMap(([v]) => v.docs ?? []))
  let vocab = loadVocab(docs, vocabs.flatMap(([v]) => v.keywords ?? []))

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
    let g: Graph | undefined
    let stopping = new AbortController()
    // Who is calling is settled before anything is built, because it is read
    // off the route modules themselves rather than from a factory: a route
    // needs the same answer the graph's own doors get, or what it writes is
    // attributed to nobody while `/apply` beside it is attributed correctly.
    let authenticate = doorman(served.map(([r]) => r), config)
    let host: Host = {
      config,
      vocab,
      sql,
      who: authenticate,
      get storage(): Store {
        if (!store) throw new Error('the store is not open yet')
        return store
      },
      get graph(): Graph {
        if (!g) throw new Error('the graph is not open yet')
        return g
      },
    }
    // The clause compilers ride the STORE, so they are gathered before it is
    // built: what a query may SAY is settled once, at compose, and every door
    // that reads — `/query`, `/ws`, a tool, the command line — asks through
    // them. A factory is handed the host with nothing open on it yet, which is
    // the same promise `graph` makes: keep it, do not call it.
    let extend = ruled.flatMap(([r, options]) =>
      r.extend?.(host, options) ?? []
    )
    store = storage(sql, vocab, {
      derived,
      extend,
      number: config.numbers ?? true,
    })
    store.install()

    // An effect writes through the graph's own door, trusted: what it writes
    // is the host's word, never a client's.
    let fx = effects(vocab, {
      write: (b) => host.graph.apply(b, { trusted: true }),
    })
    g = graph({
      storage: host.storage,
      vocab,
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
    let tools = loadTools(
      docs,
      Object.assign({}, ...tooled.map(([t]) => t.runs ?? {})) as Runs,
    )
    // The one RUNNER over this graph. A door calls a tool and records the ask
    // and the answer as it goes; what this adds is the calls NOBODY here is
    // waiting on — one written by another process through `/apply`, or one
    // wearing a wake that has now fired. Each rule is one effect registration
    // over committed changes, and a call this graph has no tool for is left
    // alone for whoever does. The `tool` rows a call points at are written on
    // the first call and at boot, never at compose: a one-shot command opens a
    // host to ask one question and should not write to say hello.
    let run = runner(g, {
      tools,
      report: (err) => console.error('tool failed —', err),
    })
    for (let rule of run.rules) {
      fx.on(rule.plan, (e) => run.run(e.entity.eid), { doc: rule.rule.name })
    }
    let routes = served.flatMap(([r, o]) => r.routes?.(host, o) ?? [])
    let door = api({ graph: g, authenticate })
    let agents = mcp({
      graph: g,
      authenticate,
      tools,
      name: config.name ?? 'yak',
    })
    let handler: Handler = (request) => {
      let path = new URL(request.url).pathname
      if (path == '/mcp') return agents(request)
      let route = routes.find((r) => routed(r, request.method, path))
      // Anything nobody claimed goes to the graph's own doors, which answer
      // `/apply`, `/query` and `/ws` and refuse the rest in the wire's shape.
      return route ? route.handle(request) : door(request)
    }
    return {
      ...host,
      graph: g,
      tools,
      runner: run,
      fx,
      handler,
      // In config order, one after another: a plugin's pass may well be about
      // rows another plugin's pass just corrected.
      boot: async () => {
        for (let [mod, options] of booted) await mod.boot?.(host, options)
      },
      // Started together and stopped together, by one signal: a host going
      // down is one fact, and a service that outlived the database it reads
      // would be a crash nobody asked for. A service that throws is reported
      // and its plugin stops — the others keep running, the way a failing
      // effect is telemetry rather than a broken host.
      start: () => {
        for (let [mod, options] of running) {
          try {
            let done = mod.service?.(host, options, stopping.signal)
            if (done) done.catch((e) => console.error('service failed —', e))
          } catch (e) {
            console.error('service failed —', e)
          }
        }
      },
      close: () => {
        stopping.abort()
        db.close()
      },
    }
  } catch (error) {
    db.close()
    throw error
  }
}

/** The composed tools as words a person types — the same tools `/mcp` lists,
 * run against the same graph, their answer printed. */
export let words = (host: Served): Word[] =>
  host.tools.map((tool) => ({
    ...tool,
    run: async (args: Record<string, unknown>, c: Ctx): Promise<number> => {
      // The command line WRITES A CALL, signed as whoever this host says it
      // is, and prints what answered it — the prose the answer carries, or
      // the bundles themselves as JSON. Calling the tool is the runner's.
      //
      // The `tool` rows a call's `to` points at come first, once per process.
      await host.runner.ensure()
      let landed = await host.runner.call([{
        entity: { eid: '$call' },
        call: {
          to: toolEid(tool.name),
          args: JSON.stringify(args ?? {}),
        },
        ...(host.config.actor ? { $actor: { by: host.config.actor } } : {}),
      }])
      c.out(worded(answerOf(landed)))
      // A refusal is data now, not a throw: the words are printed either way
      // and the exit code is what says which it was — the runner's own word,
      // since a tool that ANSWERS fault rows did not fail.
      return faulted(landed) ? 1 : 0
    },
  }))

/** Serve a config: compose it, and listen. `onListen` is told the address and
 * the host it belongs to — the composition is done before anything binds. */
export let serve = async (
  config: Config,
  onListen?: (addr: Deno.NetAddr, host: Served) => void,
): Promise<{ host: Served; server: Deno.HttpServer }> => {
  let host = await compose(config)
  // Boot: the `tool` rows a call points at, and then what a crash left
  // claimed and unanswered, finished. Here rather than in `compose`, because
  // BOOT is the server starting — a one-shot command composes the same host
  // and must not reach into calls another process is running.
  await host.runner.ensure()
  await reconcile(host.runner)
  // And each plugin's own: the locks a dead holder left, the agents still
  // running that this process has no memory of.
  await host.boot()
  // And then the clocks: what a plugin keeps doing while this is up. After
  // boot, so a sweep never races the reconciliation that corrects what it is
  // about to read.
  host.start()
  let server = Deno.serve({
    port: config.port ?? 8787,
    hostname: config.hostname,
    onListen: (addr) => onListen?.(addr, host),
  }, host.handler)
  return { host, server }
}
