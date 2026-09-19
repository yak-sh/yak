/**
 * `yak serve` — the whole server, composed from one config file.
 *
 * A host is not written; it is COMPOSED. This module reads a config naming
 * plugin modules, imports each, and takes from every one the facets it runs:
 * the words it speaks (`vocab`), what a batch means (`rules`), what an agent
 * may call (`runs`), what happens after a commit (`effects`), and the HTTP it
 * adds (`routes`). Over that it opens one SQLite file and mounts the doors —
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
 * A PLUGIN is a plain module — no registry, no manifest, no activation. It
 * exports what it has and the host takes what it runs; see {@link Module} and
 * the package README.
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
import type { Derived } from '@yaks/sql'
import { type Driver, migrations, storage, type Store } from '@yaks/sqlite'
import { Database, driver } from '@yaks/sqlite/db'
import { api, type Authenticate, type Handler } from '@yaks/api'
import { mcp } from '@yaks/mcp'
import { type Effects, effects, type Registration } from '@yaks/effects'
import type { Ctx, Word } from './run.ts'

/** What a config file says: where the graph lives, and what speaks over it. */
export type Config = {
  /** the SQLite file, `:memory:` for a graph that lasts as long as the
   * process. Required — a host never guesses a database. */
  db?: string
  /** the plugin modules, by import specifier. A relative one is resolved
   * against the config file itself. */
  plugins?: string[]
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
 * named them. `graph` is live from the moment the graph is open — a factory
 * may keep it, and may not call it before it returns. */
export type Host = {
  config: Config
  vocab: Vocab
  storage: Store
  sql: Driver
  graph: Graph
}

/** A post-commit observer, said where it belongs: beside the component it
 * watches (@yaks/effects `Registration`). */
export type Watch = Registration & { comp: string }

/** One HTTP route a plugin adds. `path` is exact, or ends in `*` for a
 * prefix; `method` is the verb, or `*` for any. */
export type Route = {
  method: string
  path: string
  handle: (request: Request) => Response | Promise<Response>
}

/**
 * A plugin module: a plain module exporting named parts, all optional.
 *
 * ```ts
 * // export let vocab = [mailDoc]
 * // export let rules = (host) => [mail(host.vocab)]
 * // export let runs = { mail_send: (bundles, ctx) => [] }
 * // export let effects = () => [{ comp: 'mail', created: (e) => deliver(e) }]
 * // export let routes = [{ method: 'POST', path: '/inbound', handle }]
 * ```
 */
export type Module = {
  /** the components and tools this plugin declares */
  vocab?: VocabDoc | VocabDoc[]
  /** JSON Schema keywords its documents use (@yaks/vocab `loadVocab`) */
  keywords?: Keywords[]
  /** columns the store computes rather than keeps, said in SQL */
  derived?: (vocab: Vocab) => Derived
  /** what a batch means: @yaks/graph plugins. It runs at compose time and may
   * install tables of its own through `host.sql`. */
  rules?: (host: Host) => Plugin[]
  /** the runs behind its `tool: true` declarations, keyed by tool name */
  runs?: Runs
  /** what happens after a commit */
  effects?: (host: Host) => Watch[]
  /** the HTTP it adds beside the doors */
  routes?: Route[]
  /** who is calling. At most one plugin may say. */
  authenticate?: Authenticate
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
  close: () => void
}

// A specifier the config file owns — `./mail.ts`, `/srv/x.ts` — is resolved
// against the config, so a config is movable and a bare `@yaks/…` is left to
// the import map.
let near = (spec: string, base: URL): string =>
  spec.startsWith('.') || spec.startsWith('/') ? new URL(spec, base).href : spec

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
    plugins: (config.plugins ?? []).map((spec) => near(spec, base)),
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

let docsOf = (mod: Module): VocabDoc[] =>
  !mod.vocab ? [] : Array.isArray(mod.vocab) ? mod.vocab : [mod.vocab]

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
let doorman = (mods: Module[], config: Config): Authenticate => {
  let said = mods.map((m) => m.authenticate).filter((a) => !!a)
  if (said.length > 1) {
    throw new Error(`${said.length} plugins authenticate — a door has one`)
  }
  if (said[0]) return said[0]
  let actor: Entity | null = config.actor ? { eid: config.actor } : null
  return () => actor
}

// Whether a route answers this request. A path ending in `*` is a prefix —
// what a route serving addressed bytes (`/blob/<sha>`) needs.
let hit = (route: Route, method: string, path: string): boolean =>
  (route.method == '*' || route.method == method) &&
  (route.path.endsWith('*')
    ? path.startsWith(route.path.slice(0, -1))
    : route.path == path)

/**
 * Compose a host from a config: import the plugins, open the database, build
 * the graph, and answer with the handler the doors are mounted on.
 *
 * `load` is how a specifier becomes a module, injected so a test composes
 * modules it wrote in place rather than files on disk.
 */
export let compose = async (
  config: Config,
  load: (spec: string) => Promise<Module> = (spec) =>
    import(spec) as Promise<Module>,
): Promise<Served> => {
  let path = dbOf(config)
  let mods = await Promise.all((config.plugins ?? []).map(load))
  // The words an invocation is written in come with the HOST, not with
  // whichever plugin happened to mention them: what was asked of this server
  // is its own transcript. A plugin that speaks them already — a harness,
  // whose transcripts ARE calls — keeps its own spelling, so only the words
  // nobody supplied are added.
  let docs = said(mods.flatMap(docsOf))
  let vocab = loadVocab(docs, mods.flatMap((m) => m.keywords ?? []))

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
      ...mods.map((m) => m.derived?.(vocab) ?? {}),
    )
    let store = storage(sql, vocab, {
      derived,
      number: config.numbers ?? true,
    })
    store.install()

    let g: Graph | undefined
    let host: Host = {
      config,
      vocab,
      storage: store,
      sql,
      get graph(): Graph {
        if (!g) throw new Error('the graph is not open yet')
        return g
      },
    }
    // An effect writes through the graph's own door, trusted: what it writes
    // is the host's word, never a client's.
    let fx = effects(vocab, {
      write: (b) => host.graph.apply(b, { trusted: true }),
    })
    g = graph({
      storage: store,
      vocab,
      plugins: [...mods.flatMap((m) => m.rules?.(host) ?? []), fx],
    })
    for (let mod of mods) {
      for (let { comp, ...watch } of mod.effects?.(host) ?? []) {
        fx.on(comp, watch)
      }
    }
    let tools = loadTools(
      docs,
      Object.assign({}, ...mods.map((m) => m.runs ?? {})) as Runs,
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
    let routes = mods.flatMap((m) => m.routes ?? [])
    let authenticate = doorman(mods, config)
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
      let route = routes.find((r) => hit(r, request.method, path))
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
      close: () => db.close(),
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
  let server = Deno.serve({
    port: config.port ?? 8787,
    hostname: config.hostname,
    onListen: (addr) => onListen?.(addr, host),
  }, host.handler)
  return { host, server }
}
