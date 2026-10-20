/** Assemble a graph from role-selected facets and capabilities lent by its host. */
import type { Actor, Comp, Graph, NamedTool } from '@yaks/graph'
import type { graph } from '@yaks/graph'
import { toolName } from '@yaks/graph/call'
import { loadTools, type Search, tier } from '@yaks/graph/tools'
import type { Reply, Runner, runner } from '@yaks/tools'
import { CallError } from '@yaks/tools/errors'
import { toolsIn } from '@yaks/vocab/tools'
import { effectsIn } from '@yaks/vocab'
import type { VocabDoc } from '@yaks/vocab'
import type { Effects, Handlers } from '@yaks/effects'
import type { Extension, Stmt } from '@yaks/sql'
import { gather } from '@yaks/ui/contributions'
import type { Authenticate, Filter, Handler, Route } from '@yaks/api'
import type { Host, Role } from './mod.ts'
import {
  chosen,
  type Config,
  type Configured,
  facetsOf,
  given,
  type Options,
  used,
} from './config.ts'
import type { Duty, FacetName, Load, Meaning } from './facets.ts'
import { type Composition, compositionAnatomy } from './anatomy.ts'
import { common, ROLES } from './roles.ts'
import { type Taken, taking, type Words, wordsOf } from './words.ts'
import { selected } from './documents.ts'

/** The parts built from facets, rather than lent by a concrete host. */
type Built =
  | 'anatomy'
  | 'observe'
  | 'config'
  | 'roles'
  | 'vocab'
  | 'derived'
  | 'storage'
  | 'graph'
  | 'fx'
  | 'ui'
  | 'who'
  | 'feed'
  | 'handler'
  | 'routes'
  | 'filters'
  | 'tools'
  | 'search'
  | 'reply'
  | 'runner'
  | 'defer'

/** Storage and runtime capabilities; the assembly owns neither their IO nor lifetime. */
export type Binding = {
  host: Omit<Host, Built>
  storage: (host: Host, extend: Extension[], words: Words) => Host['storage']
  effects: (host: Host, disabled: string[]) => Effects
  /** Host clause compilers follow the plugins' compilers. */
  extend?: (host: Host) => Extension[]
  /** Construct the graph with any additional hooks and options the host owns. */
  graph?: typeof graph
  /** Bring the store to its composed schema, given the statements the graph
   * plugins need beside the store's own, after extensions have bound and
   * before graph plugins are asked. A reader leaves it out. */
  schema?: (host: Host, stmts: Stmt[]) => void
  /** The host's graph-dependent capabilities, before effect and tool factories. */
  ready?: (host: Host) => void
  /** Combine the host's text index with its meaning index, where it has one
   * ({@link Host.meaning}). */
  search?: (host: Host) => Search | undefined
  actor?: Actor | null
  process?: Comp
  readOnly?: boolean
  /** Per-host capabilities added to a configured occurrence's options. */
  options?: (plugin: string, options: Options) => Options
  /** Loading and binding evidence belongs to this host, never the shared plan. */
  observed?: Composition
}
export type Assembly = {
  words: Words
  /** The plugins whose graph facet says, under its options, that a store this
   * host writes requires it (GraphFacet `required`): what a writing host
   * records in the store beside its schema. */
  required: string[]
  /** Bind the loaded facets to the host's capabilities. Services are returned for its scheduler. */
  bind: (binding: Binding) => {
    host: Host
    services: Duty[]
    /** Await after draining admitted work, before closing graph or reporter. */
    close: () => Promise<void>
  }
}
export type AssemblyOpts = {
  /** Read factories admit no imperative work; loaded before binding. */
  readOnly?: boolean
  /** Resolved plugin options, when the concrete host has a vault. */
  plugins?: Configured[]
  /** Already-loaded vocabulary, shared with the concrete host's schema plan. */
  words?: Words
  /** The graph's own vocabulary. Its component declarations shadow plugins. */
  docs?: VocabDoc[]
  observed?: Composition
  part?: (name: string) => void
}
// At most one plugin may name the caller; two would mean the answer depends on
// import order, which is not an answer. Whoever it is, this PROCESS is the
// fallback: a request no plugin claimed is this machine's own writing, not
// nobody's.
let doorman = (
  graphs: Taken<'graph'>,
  host: Host,
  self: Actor | null,
): Authenticate => {
  let said = graphs.filter(([r]) => r.authenticate)
  if (said.length > 1) {
    throw new CallError(
      'config',
      `${said.length} plugins authenticate — a door has one`,
    )
  }
  let [mod, options] = said[0] ?? []
  let ask = mod?.authenticate?.(host, options ?? {})
  return ask ? async (request) => (await ask(request)) ?? self : () => self
}

// A plugin's `./effects` handling a name no vocabulary declares: code that
// would never run, since nothing owes it.
let undeclared = (plugin: string, name: string) =>
  new CallError('config', `${plugin} handles ${name}, which nothing declares`)

// Two plugins' `./effects` handling one name: a run is done once, by one.
let twice = (name: string, plugins: string[]) =>
  new CallError('config', `${name} is handled by both ${plugins.join(' and ')}`)

/** The role-selected modules, loaded before a host opens its transaction. */
export type Prepared = {
  vocab: Taken<'vocab'>
  graph: Taken<'graph'>
  effects: Taken<'effects'>
  routes: Taken<'routes'>
  ui: Taken<'ui'>
  service: Taken<'service'>
  factories: { graph: typeof graph; runner: typeof runner }
}

let configured = (config: Config): Configured[] =>
  (config.plugins ?? []).map((p) => [used(p), given(p), chosen(p), facetsOf(p)])

/** Import only the facets a host serves; binding the result performs no imports. */
export let prepare = async (
  config: Config,
  roles: readonly Role[],
  load: Load,
  opts: AssemblyOpts = {},
): Promise<Prepared> => {
  if (!roles.includes('graph')) {
    throw new CallError(
      'config',
      'a host opens a graph — its roles include graph',
    )
  }
  let plugins = opts.plugins ?? configured(config)
  let services = roles.filter((r) => !common(r))
  for (let r of services) {
    if (!plugins.some(([p]) => p == r)) {
      throw new CallError(
        'config',
        `no plugin ${r} in this config serves that role`,
      )
    }
  }
  let observed = opts.observed
  let observedLoad: Load = async (plugin, name) => {
    observed?.attempted(plugin, name)
    let loaded = await load(plugin, name)
    observed?.loaded(plugin, name, loaded !== null)
    return loaded
  }
  let take = <F extends FacetName>(role: Role, name: F): Promise<Taken<F>> =>
    roles.includes(role)
      ? taking(plugins, name, observedLoad)
      : Promise.resolve([])
  opts.part?.('facets')
  await load.together?.(plugins.flatMap(([plugin, , , facets]) =>
    [
      'vocab' as const,
      'graph' as const,
      ...roles.includes('effects') ? ['effects'] as const : [],
      ...roles.includes('web') ? ['routes', 'ui'] as const : [],
      ...services.includes(plugin) ? ['service'] as const : [],
    ].filter((name) => facets === undefined || facets.includes(name)).map((
      name,
    ) => [plugin, name] as const)
  ))
  let [vocab, graph, effects, routes, ui, service, factories] = await Promise
    .all([
      take('graph', 'vocab'),
      take('graph', 'graph'),
      take('effects', 'effects'),
      take('web', 'routes'),
      take('web', 'ui'),
      taking(
        plugins.filter(([p]) => services.includes(p)),
        'service',
        observedLoad,
      ),
      opts.readOnly
        ? Promise.all([import('@yaks/graph/read'), import('@yaks/tools/read')])
          .then(([g, t]) => ({ graph: g.graph, runner: t.reader }))
        : Promise.all([import('@yaks/graph'), import('@yaks/tools')]).then((
          [g, t],
        ) => ({ graph: g.graph, runner: t.runner })),
    ])
  return { vocab, graph, effects, routes, ui, service, factories }
}

/** Pure assembly of imported facets; its binding runs inside the host's transaction. */
export let assemble = (
  config: Config,
  roles: readonly Role[],
  load: Load,
  prepared: Prepared,
  opts: AssemblyOpts = {},
): Assembly => {
  let plugins = opts.plugins ?? configured(config)
  let part = opts.part
  let modules = <F extends FacetName>(name: F): Taken<F> => {
    let loaded = prepared[name as keyof Prepared] as Taken<F>
    // Each configured occurrence keeps its own options, including repeated
    // selections of one package. Facets may be absent, so module positions
    // alone cannot identify their configured entries.
    let key = (plugin: string, names?: string[], facets?: FacetName[]) =>
      JSON.stringify([
        plugin,
        names && [...new Set(names)].sort(),
        facets && [...new Set(facets)].sort(),
      ])
    let options = Map.groupBy(
      plugins,
      ([plugin, , names, facets]) => key(plugin, names, facets),
    )
    return loaded.map(([mod, original, plugin, names, facets]) => {
      let entry = options.get(key(plugin, names, facets))?.shift()
      return [mod, entry?.[1] ?? original, plugin, names, facets]
    })
  }
  let vocabs = modules('vocab')
  let imported = {
    graph: modules('graph'),
    effects: roles.includes('effects') ? modules('effects') : [],
    routes: roles.includes('web') ? modules('routes') : [],
    ui: roles.includes('web') ? modules('ui') : [],
    service: modules('service'),
  }
  part?.('vocabulary')
  let words = opts.words ?? wordsOf(vocabs, opts.docs)
  let { docs, vocab, derived } = words
  let contributions = vocabs.map(([v, options, plugin, names, facets]) => {
    let docs = selected(v.docs ?? [], names, plugin)
    return { docs, options, plugin, facets, effects: effectsIn(docs) }
  })
  let declared = new Set(effectsIn(docs).map((e) => e.name))
  let original = new Set(
    vocabs.flatMap(([v]) => effectsIn(v.docs ?? []).map((e) => e.name)),
  )
  let omissions = imported.effects.map(([, options, plugin, names]) => {
    let vocabulary = vocabs.find(([, o, p, n]) =>
      p == plugin && o === options && n === names
    )
    return new Set(
      names === undefined ? [] : effectsIn(vocabulary?.[0].docs ?? [])
        .filter((e) => !names.includes(e.name)).map((e) => e.name),
    )
  })

  let required = [
    ...new Set(
      imported.graph.filter(([r, options]) => r.required?.(options))
        .map(([, , plugin]) => plugin),
    ),
  ]

  return {
    words,
    required,
    bind: (binding) => {
      let resources = new AsyncDisposableStack()
      let closing: Promise<void> | undefined
      let observed = binding.observed ?? opts.observed ?? compositionAnatomy(
        plugins.map(([name, , , facets]) => ({ name, facets })),
        roles,
        ROLES,
      )
      let observedLoad: Load = async (plugin, name) => {
        observed.attempted(plugin, name)
        let loaded = await load(plugin, name)
        observed.loaded(plugin, name, loaded !== null)
        return loaded
      }
      let boundOptions = new Map<Options, Map<string, Options>>()
      let optionsOf = (plugin: string, options: Options): Options => {
        if (!binding.options) return options
        let by = boundOptions.get(options)
        if (!by) boundOptions.set(options, by = new Map())
        let bound = by.get(plugin)
        if (!bound) by.set(plugin, bound = binding.options(plugin, options))
        return bound
      }
      let bound = <F extends FacetName>(
        name: F,
        loaded: Taken<F>,
      ): Taken<F> => {
        for (let [plugin, , , facets] of plugins) {
          if (facets !== undefined && !facets.includes(name)) continue
          observed.attempted(plugin, name)
          observed.loaded(plugin, name, loaded.some(([, , p]) => p == plugin))
        }
        return loaded.map((
          [mod, options, plugin, names, facets],
        ) => [mod, optionsOf(plugin, options), plugin, names, facets])
      }
      let graphs = bound('graph', imported.graph)
      let watched = roles.includes('effects')
        ? bound('effects', imported.effects)
        : []
      let served = roles.includes('web') ? bound('routes', imported.routes) : []
      let dressed = roles.includes('web') ? bound('ui', imported.ui) : []
      let running = bound('service', imported.service)
      bound('vocab', vocabs)
      part?.('anatomy')
      observed.declarations(docs, vocab)
      let { host: lent, actor: self, process, readOnly } = binding
      let g: Graph | undefined
      let store: Host['storage'] | undefined
      let watching: Effects | undefined
      let answering: Handler | undefined
      let paths: Route[] = []
      let filters: Filter[] = []
      let made: NamedTool[] | undefined
      let ranked: Search | undefined
      let meant: Meaning | undefined = lent.meaning
      let replying: Reply | undefined
      let calls: Runner | undefined
      let makeTools: (() => NamedTool[]) | undefined
      let makeRunner: (() => Runner) | undefined
      let toolPart = part
      let host: Host = {
        ...lent,
        defer: (release) => resources.defer(release),
        config,
        roles,
        vocab,
        derived,
        anatomy: () => {
          if (makeTools) host.tools
          return observed.read()
        },
        observe: observed.observe,
        ui: gather(dressed.map(([facet]) => facet)),
        who: (request) => authenticate(request),
        // Present only when a plugin offers one: a host without it polls its
        // store's revision instead (@yaks/api routes), so another process's
        // commits still reach its subscriptions.
        feed: graphs.some(([r]) => r.feed)
          ? (each) => {
            let stops = graphs.flatMap(([r, options]) =>
              r.feed ? [r.feed(host, options)(each)] : []
            )
            return () => stops.forEach((stop) => stop())
          }
          : undefined,
        get storage() {
          if (!store) throw new Error('the store is not open yet')
          return store
        },
        get graph() {
          if (!g) throw new Error('the graph is not open yet')
          return g
        },
        get fx() {
          if (!watching) throw new Error('the effects are not built yet')
          return watching
        },
        get tools() {
          if (!makeTools) throw new Error('the tools are not built yet')
          return made ??= makeTools()
        },
        get runner() {
          if (!makeRunner) throw new Error('the tool runner is not built yet')
          return calls ??= makeRunner()
        },
        get handler() {
          return answering
        },
        get routes() {
          return paths
        },
        get filters() {
          return filters
        },
        get search() {
          return ranked
        },
        get meaning() {
          return meant
        },
        get reply() {
          return replying
        },
      }
      for (let [ui, , plugin] of dressed) {
        observed.observe({
          package: plugin,
          facet: 'ui',
          loaded: true,
          bound: true,
          value: ui,
        })
      }
      let authenticate = doorman(graphs, host, self ?? null)
      part?.('storage')
      let extend: Extension[] = []
      store = binding.storage(host, extend, words)
      part?.('extensions')
      extend.push(
        ...graphs.flatMap(([r, options]) => r.extend?.(host, options) ?? []),
      )
      extend.push(...binding.extend?.(host) ?? [])
      part?.('schema')
      binding.schema?.(
        host,
        graphs.flatMap(([r, options]) => r.schema?.(host, options) ?? []),
      )
      part?.('effects')
      let fx = watching = binding.effects(
        host,
        contributions.flatMap(({ effects, options, plugin }) =>
          effects.filter((e) =>
            e.option && optionsOf(plugin, options)[e.option] !== true
          )
            .map((e) => e.name)
        ),
      )
      part?.('plugins')
      let contributed = graphs.flatMap(([r, options, plugin]) => {
        // Vocabulary facets and graph-owned documents are the declarations.
        // A graph plugin's legacy document must not reintroduce words or rules
        // that selection omitted, or that the graph's own declarations shadow.
        let made = (r.plugins?.(host, options) ?? []).map((p) => ({
          ...p,
          vocab: [],
        }))
        observed.graph(plugin, made)
        return made
      })
      observed.graph('@yaks/effects', [fx])
      // A numbered entity is printed as an id a person types back (`T-7`), and a
      // graph that reads none back takes `T-7` for an eid and mints an entity of
      // that name. So a config that numbers entities names a plugin that
      // resolves them.
      let graphing = roles.includes('graph')
      if (config.numbers && graphing && !contributed.some((p) => p.address)) {
        throw new CallError(
          'config',
          '`numbers` prints ids like T-7, and no plugin in this config reads ' +
            'one back — add @yaks/id to plugins',
        )
      }
      part?.('graph')
      g = (binding.graph ?? prepared.factories.graph)({
        storage: host.storage,
        vocab,
        // A write no request attributed is the host's own: its rules, its
        // effects, its start-up passes and the bulk loads it is handed are all
        // stored attributed to this process.
        ...(self ? { actor: self } : {}),
        plugins: [...contributed, fx],
      })
      binding.ready?.(host)
      part?.('bindings')
      observed.graphed()
      let effecting = roles.includes('effects')
      observed.effects(new Map(), effecting)
      if (effecting) {
        let code: Handlers = {}
        let by = new Map<string, string>()
        for (let [i, [mod, options, plugin]] of watched.entries()) {
          let omitted = omissions[i]
          for (
            let [name, run] of Object.entries(
              mod.effects?.(host, options) ?? {},
            )
          ) {
            // A selected-out declaration is intentionally absent, even where
            // another plugin lends its handler. An unknown name is still a typo.
            if (
              omitted.has(name) || !declared.has(name) && original.has(name)
            ) {
              continue
            }
            if (!declared.has(name)) throw undeclared(plugin, name)
            if (by.has(name)) throw twice(name, [by.get(name)!, plugin])
            by.set(name, plugin)
            code[name] = run
          }
        }
        fx.handle(code)
        observed.effects(by, true)
      }
      part?.('search')
      // One meaning index: the one a plugin offers, or the one the host lends.
      let meanings = [
        ...(meant ? [meant] : []),
        ...graphs.flatMap(([r, options]) =>
          r.meaning ? [r.meaning(host, options)] : []
        ),
      ]
      if (meanings.length > 1) {
        throw new CallError(
          'config',
          'more than one meaning index answers search',
        )
      }
      meant = meanings[0]
      ranked = binding.search?.(host)
      // The generic tools belong to this graph, not to any transport: they are
      // declared in @yaks/graph's own vocabulary and implemented there, and a
      // host has a graph whether or not anything is listening. So the tier is
      // assembled here beside the plugins' own, in the form the vocabulary
      // declares, and a transport that needs them in its own form restates them
      // (@yaks/mcp `core`).
      //
      // A plugin's own tools are listed from its vocabulary and run by its
      // `./tools`, imported the first time one of them is called.
      makeTools = () => {
        toolPart?.('tools')
        let generic = tier({ search: ranked, keywords: vocab.keywords })
        observed.tier(generic)
        return [
          ...generic,
          ...contributions.filter(({ facets }) =>
            facets === undefined || facets.includes('tools')
          ).flatMap(({ docs, options, plugin }) =>
            loadTools(docs, async () => {
              let code = await observedLoad(plugin, 'tools')
              let runs = code?.runs?.(host, optionsOf(plugin, options)) ?? {}
              let declarations = toolsIn(docs)
              let names = declarations.map((d) => d.name ?? toolName(d))
              let joined = declarations.filter((d) =>
                typeof (runs[d.name ?? toolName(d)] ??
                  runs[[d.noun, d.verb].filter(Boolean).join('_')]) ==
                  'function'
              ).map((d) => d.name ?? toolName(d))
              // loadTools joins the whole module; a missing run rejects that join.
              observed.runs(
                plugin,
                joined,
                joined.length == names.length ? joined : [],
              )
              return runs
            })
          ),
        ]
      }
      let replies = graphs.flatMap(([r, options]) =>
        r.reply ? [r.reply(host, options)] : []
      )
      replying = replies.length
        ? async (call, answer, wrote) =>
          (await Promise.all(replies.map((r) => r(call, answer, wrote)))).flat()
        : undefined
      // The one tool runner over this graph. A caller runs a tool and the runner
      // records the request and the result as it goes; what the two effects
      // @yaks/tools declares add, in a process serving `effects`, is the calls
      // nobody is waiting on — one written through `/apply`, or one whose
      // scheduled wake has now fired. A call this graph has no tool for is left
      // alone for whoever does have it. The `tool` rows a call points at are
      // written on the first call and at start-up, never while assembling: a
      // one-shot command opens a host to ask one question and should not write
      // just to say hello.
      makeRunner = () => {
        let tools = host.tools
        toolPart?.('runner')
        return prepared.factories.runner(g!, {
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
          ...process ? { process } : {},
          report: (error, call, tool) =>
            readOnly ? console.error(error) : host.report?.(error, {
              actor: call.$actor ?? self ?? undefined,
              during: {
                entity: call.entity.eid,
                kind: 'call',
                process: host.me,
              },
              tags: { tool },
            }),
          ...replying ? { reply: replying } : {},
        })
      }
      // A graph-only caller can read and write without paying to build tools
      // it never asks for. Effects need the runner now to register owed calls;
      // every other caller reaches the same construction through Host.
      if (effecting) {
        let run = host.runner
        let due: Handlers[string] = (e) => run.due(e.entity.eid)
        fx.handle(
          Object.fromEntries(
            run.rules.filter((r) => declared.has(r.rule.name)).map((
              r,
            ) => [r.rule.name, due]),
          ),
        )
        observed.due(run.rules.map((r) => r.rule.name))
      }
      // Which listed plugin hosts the routes — turns them into the one handler
      // this host answers with (@yaks/api). Two would be two answers to one
      // request, which is not an answer. None means nothing here serves HTTP, so
      // the other plugins are never asked for routes: a facet whose whole
      // purpose is a listener that does not exist is a facet this host ignores.
      // `served` is empty in a process that does not serve `web`.
      let hosts = served.filter(([r]) => r.handler)
      if (hosts.length > 1) {
        throw new CallError(
          'config',
          `${hosts.length} plugins host routes — a host has one`,
        )
      }
      let [mod, options] = hosts[0] ?? []
      if (mod?.handler) {
        paths = served.flatMap(([r, o, plugin]) => {
          let made = r.routes?.(host, o) ?? []
          observed.routes(plugin, made)
          return made
        })
        filters = served.flatMap(([r, o]) =>
          r.filter ? [r.filter(host, o)] : []
        )
        answering = mod.handler(host, options ?? {})
        observed.binding(hosts[0][2], 'routes')
      }
      let duties: Duty[] = running.map(([mod, options, plugin]): Duty => {
        observed.binding(plugin, 'service')
        return {
          name: plugin,
          run: (signal) => mod.service!(host, options, signal),
        }
      })
      // Deferred capabilities run after composition's timing spans have ended.
      toolPart = undefined
      return {
        host,
        services: duties,
        close: () => closing ??= resources.disposeAsync(),
      }
    },
  }
}

/** Load only the roles served, then assemble once the host can lend storage. */
export let assembly = async (
  config: Config,
  roles: readonly Role[],
  load: Load,
  opts: AssemblyOpts = {},
): Promise<Assembly> =>
  assemble(config, roles, load, await prepare(config, roles, load, opts), opts)
