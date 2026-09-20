/**
 * `yak serve` — the whole server, composed from one config file.
 *
 * A host is not written; it is COMPOSED. This module reads a config naming
 * plugin packages and imports, from each, the FACETS it runs — one subpath
 * apiece: the words it speaks (`@yaks/mail/vocab`), what a batch means
 * (`/rules`), what an agent may call (`/tools`), what happens after a commit
 * (`/effects`), the HTTP it adds (`/routes`), what it says at the start of a
 * transcript (`/digest`), and the one pass it makes at start-up (`/boot`) and
 * what it keeps doing while the host is up (`/service`). A subpath a package does not
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
  type Actor,
  type Bundle,
  detached,
  type Graph,
  graph,
  type NamedTool,
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
import { idKeywords, minted } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { HOST, hosted, hostEid } from '@yaks/kernel'
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
import { mcp, type Search } from '@yaks/mcp'
import { composed, type Digest, type Sections } from '@yaks/context'
import { adopt, fields as searched, find, search } from '@yaks/fts'
import {
  type Effects,
  effects,
  type SweepRows,
  type Watch,
} from '@yaks/effects'
import { type Config, given, type Options, PORT, used } from './config.ts'

export {
  type Config,
  configPath,
  doorOf,
  given,
  type Options,
  type Plug,
  read,
  used,
} from './config.ts'

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
   * nobody. One plugin may say it; where it says nobody, the answer is this
   * host itself ({@link writer}). */
  who: Authenticate
  /** what a session is told at its start: every plugin's sections, in weight
   * order (@yaks/context `composed`). Live from the moment the plugins are
   * imported — a factory may keep it, and may not call it before it returns. */
  digest: Digest
}

/** The facets a host takes from a plugin, one subpath each. `views` is not
 * among them: a renderer is the WEB door's to import, never a server's. Nor is
 * `words`: a word runs on the box that typed it, against the checkout it
 * stands in, so the `yak` command carries those (yak.ts `here`). */
export let FACETS = [
  'vocab',
  'rules',
  'tools',
  'effects',
  'routes',
  'digest',
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
 * tool name.
 *
 * A FACTORY, like every other facet, because a run needs the same things they
 * do: a check over a package's own SQL table reaches it through `host.sql`
 * (@yaks/sqlite's storage scan, @yaks/embedding's vector index), and a
 * threshold or a relation name is the config's to say, not the code's. What a
 * run is handed per CALL — the graph, the caller, the arguments — still rides
 * the tool context. */
export type ToolsFacet = { runs?: (host: Host, options: Options) => Runs }

/** `<plugin>/effects` — what happens after a commit. A sender, a spawner, a
 * sweep: what an effect ACTS on is named in this plugin's options. */
export type EffectsFacet = {
  effects?: (host: Host, options: Options) => Watch[]
}

/** `<plugin>/routes` — the HTTP it adds beside the doors, and, for at most one
 * plugin in a host, who is calling.
 *
 * `authenticate` is a FACTORY like every other facet, because naming a caller
 * is a read: @yaks/session answers a request with the transcript it says it
 * speaks for, which it can only do through the host's own graph. It is handed
 * the host with nothing open on it yet — keep it, do not call it. */
export type RoutesFacet = {
  routes?: (host: Host, options: Options) => Route[]
  authenticate?: (host: Host, options: Options) => Authenticate
}

/** `<plugin>/digest` — what this plugin says at the START of a transcript: a
 * factory answering the sections it contributes to the prose a session reads
 * before its first turn (@yaks/context `Section`). `weight` is where they sit
 * — lower leads, and the config's order breaks a tie — so the owner's words
 * come before what the work is FOR whatever order the plugins were named in.
 * A section is written from the transcript and the graph alone, never from
 * another section, so no contributor has to know what any other one says. */
export type DigestFacet = {
  digest?: (host: Host, options: Options) => Sections
  weight?: number
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
  digest: DigestFacet
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

// The keywords that are the HOST's rather than any plugin's: what letter an
// id wears (`prefix`, @yaks/id) and which column is a name somebody may type
// (`by_name`, @yaks/names). Every package spells them in its `$vocabulary`,
// none registers them — and an unregistered keyword is silently dropped, so a
// host that skipped these would mint `entity.num` and then render `P-1` for a
// persona that declared `N`, having fallen back to the component's initial.
// Minting the number and answering in human ids are both this host's doing,
// so reading the words that shape them is too. A plugin that supplies its own
// copy wins; this is the difference, never a second registration.
let understood = (brought: Keywords[]): Keywords[] => {
  let taken = new Set(brought.map((k) => k.uri))
  return [
    ...brought,
    ...[idKeywords, nameKeywords].filter((k) => !taken.has(k.uri)),
  ]
}

/**
 * Who a host writes as where no door named a caller: the entity its config's
 * `actor` names, acting for itself through itself.
 *
 * A NAME is the host's own identity — it mints that row at start-up
 * (@yaks/kernel `hosted`) and its id is derived from the name, so nothing is
 * looked up and no uuid is pasted into a config. An id this family minted
 * names something somebody else made, and is signed with as it stands.
 *
 * ```ts
 * writer({ actor: 'yak' })?.by == writer({ actor: 'yak' })?.by // true
 * ```
 */
export let writer = (config: Config): Actor | null => {
  if (!config.actor) return null
  let eid = minted(config.actor) ? config.actor : hostEid(config.actor)
  return { by: eid, via: eid }
}

// Exactly one plugin may say who is calling; two would mean the door's answer
// depends on import order, which is not an answer. Whoever it is, the HOST is
// the floor: a request no plugin claimed is the box's own writing, not
// nobody's.
let doorman = (
  served: [RoutesFacet, Options][],
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
  let telling = taken('digest')
  let booted = taken('boot')
  let running = taken('service')

  // The words an invocation is written in come with the HOST, not with
  // whichever plugin happened to mention them: what was asked of this server
  // is its own transcript. A plugin that speaks them already — a harness,
  // whose transcripts ARE calls — keeps its own spelling, so only the words
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
    // SEARCH is a property of the WORDS: a column that declared itself
    // `search: true` is indexed, whoever declared it, so composing @yaks/fts
    // here rather than in a plugin is the vocabulary being taken at its word.
    // Two things fall out of the one list — a bare word on any query line
    // compiles to a match (one more clause compiler beside the plugins'), and
    // `/mcp` lists a ranked `search`.
    let text = searched(vocab)

    let g: Graph | undefined
    let stopping = new AbortController()
    // Who is calling is settled before anything is built: a route needs the
    // same answer the graph's own doors get, or what it writes is attributed
    // to nobody while `/apply` beside it is attributed correctly. The host
    // itself is that answer until the plugins are asked, which is a moment
    // later — `who` reads the binding rather than a copy of it.
    let self = writer(config)
    let authenticate: Authenticate = () => self
    let told: Digest | undefined
    let host: Host = {
      config,
      vocab,
      sql,
      who: (request) => authenticate(request),
      get digest(): Digest {
        if (!told) throw new Error('the digest is not composed yet')
        return told
      },
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
    // What a session is told, settled here for the reason authentication is:
    // the tool that answers it (@yaks/session's `session_context`) reads it off
    // the host, and a factory built later would have nothing to read. Each
    // plugin's sections keep the weight its own module declared; the config's
    // order breaks a tie.
    told = composed(
      telling.flatMap(([d, options]) =>
        d.digest
          ? [{ sections: d.digest(host, options), weight: d.weight }]
          : []
      ),
    )
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
      extend: text.length ? [...extend, search(text)] : extend,
      number: config.numbers ?? true,
      adopt: config.adopt ?? false,
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
      // A batch no door signed is the host's own: its rules, its effects, its
      // boot passes and the loads it is handed all land attributed.
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
    // After every table, the plugins' own included: an index is CUT from the
    // tables it reads, and a column the graph keeps under a content address is
    // read through the plugin's — so the index is raised once the rules have
    // installed theirs. `adopt` makes the indexes stand equal to what the
    // vocabulary says and rebuilds one that drifted, and writes nothing on a
    // boot where nothing moved.
    if (text.length) adopt(sql, text, derived)
    let tools = loadTools(
      docs,
      Object.assign(
        {},
        ...tooled.map(([t, options]) => t.runs?.(host, options) ?? {}),
      ) as Runs,
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
    let door = api({ graph: g, authenticate: host.who })
    // Ranked words, for the door that asks for them. Membership is already
    // answered by the extension above; this is the order they come back in.
    let ranked: Search | undefined = text.length
      ? async (words, opts) => {
        let hits = find(sql, text, words, { limit: opts?.limit })
        let found = await detached(host.storage).get(hits.map((h) => h.entity))
        let at = new Map(found.map((b) => [b.entity.eid, b]))
        return hits.map((h) => at.get(h.entity)).filter((b) => !!b)
      }
      : undefined
    let agents = mcp({
      graph: g,
      authenticate: host.who,
      tools,
      search: ranked,
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

/**
 * What an effect's `sweep` means here: its `pending` is a query in the graph's
 * own grammar, so the rows it names are read the way everything else is, and
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

/**
 * The host's own row, written before anything it signs points at it:
 * `created.by` is a REFERENCE, so a server signing with an entity nothing
 * minted would write a dangling id on its first breath. Idempotent — the id is
 * derived from the name, so every start says the same thing.
 *
 * A config that signs with an id this family minted names something somebody
 * else made, and nothing is written for it: that entity is not this host's.
 */
export let own = async (host: Served): Promise<void> => {
  let said = host.config.actor
  if (!said || minted(said) || !host.vocab.comp(HOST)) return
  await host.graph.apply([hosted(said)])
}

/** Serve a config: compose it, and listen. `onListen` is told the address and
 * the host it belongs to — the composition is done before anything binds. */
export let serve = async (
  config: Config,
  onListen?: (addr: Deno.NetAddr, host: Served) => void,
): Promise<{ host: Served; server: Deno.HttpServer }> => {
  let host = await compose(config)
  // Whose server this is, first of all: everything below is signed with it.
  await own(host)
  // Boot: the `tool` rows a call points at, and then what a crash left
  // claimed and unanswered, finished. Here rather than in `compose`, because
  // BOOT is the server starting — a one-shot command composes the same host
  // and must not reach into calls another process is running.
  await host.runner.ensure()
  await reconcile(host.runner)
  // And each plugin's own: the locks a dead holder left, the agents still
  // running that this process has no memory of.
  await host.boot()
  // Then the effects that said what "still pending" LOOKS like: an effect is
  // at-most-once, and a crash between the commit and the handler is exactly
  // what the `sweep` on a registration is for. Its query is the graph's own,
  // so the rows are read the way everything else here reads — and a handler
  // that declared a sweep promised to be idempotent, since this re-drives what
  // may well have run.
  await host.fx.relay(unfinished(host.graph))
  // And then the clocks: what a plugin keeps doing while this is up. After
  // boot, so a sweep never races the reconciliation that corrects what it is
  // about to read.
  host.start()
  let server = Deno.serve({
    port: config.port ?? PORT,
    hostname: config.hostname,
    onListen: (addr) => onListen?.(addr, host),
  }, host.handler)
  return { host, server }
}
