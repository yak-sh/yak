/** Assemble a graph from role-selected facets and capabilities lent by its host. */
import {
  type Actor,
  type Comp,
  type Graph,
  graph,
  type NamedTool,
  toolName,
} from '@yaks/graph'
import { loadTools, type Search, tier } from '@yaks/graph/tools'
import { type Reply, type Runner, runner } from '@yaks/tools'
import { toolsIn } from '@yaks/vocab/tools'
import { effectsIn } from '@yaks/vocab'
import type { Effects, Handlers } from '@yaks/effects'
import type { Extension } from '@yaks/sql'
import { gather } from '@yaks/ui/contributions'
import type { Authenticate, Filter, Handler, Route } from '@yaks/api'
import type { Host, Role } from './mod.ts'
import { type Config, given, type Options, used } from './config.ts'
import type { Duty, FacetName, GraphFacet, Load, MeaningHit } from './facets.ts'
import { type Composition, compositionAnatomy } from './anatomy.ts'
import { common, ROLES } from './roles.ts'
import { type Taken, taking, type Words, wordsOf } from './words.ts'

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

/** Storage and runtime capabilities; the assembly owns neither their IO nor lifetime. */
export type Binding = {
  host: Omit<Host, Built>
  storage: (host: Host, extend: Extension[], words: Words) => Host['storage']
  effects: (host: Host, disabled: string[]) => Effects
  /** Host clause compilers follow the plugins' compilers. */
  extend?: (host: Host) => Extension[]
  /** Construct the graph with any additional hooks and options the host owns. */
  graph?: typeof graph
  /** Schema work after extensions have bound, before graph plugins are asked. */
  install?: (host: Host) => void
  /** The host's graph-dependent capabilities, before effect and tool factories. */
  ready?: (host: Host) => void
  /** Combine the host's text index with the plugin's optional meaning index. */
  search?: (host: Host, meaning?: Meaning) => Search | undefined
  actor?: Actor | null
  process?: Comp
  readOnly?: boolean
}
export type Meaning = (
  words: string,
  opts?: { limit?: number },
) => Promise<MeaningHit[]>
export type Assembly = {
  words: Words
  /** Bind the loaded facets to the host's capabilities. Services are returned for its scheduler. */
  bind: (binding: Binding) => { host: Host; services: Duty[] }
}
export type AssemblyOpts = {
  /** Resolved plugin options, when the concrete host has a vault. */
  plugins?: [string, Options][]
  observed?: Composition
  part?: (name: string) => void
}
// At most one plugin may name the caller; two would mean the answer depends on
// import order, which is not an answer. Whoever it is, this PROCESS is the
// fallback: a request no plugin claimed is this machine's own writing, not
// nobody's.
let doorman = (
  graphs: [GraphFacet, Options, string][],
  host: Host,
  self: Actor | null,
): Authenticate => {
  let said = graphs.filter(([r]) => r.authenticate)
  if (said.length > 1) {
    throw new Error(`${said.length} plugins authenticate — a door has one`)
  }
  let [mod, options] = said[0] ?? []
  let ask = mod?.authenticate?.(host, options ?? {})
  return ask ? async (request) => (await ask(request)) ?? self : () => self
}

// A plugin's `./effects` handling a name no vocabulary declares: code that
// would never run, since nothing owes it.
let undeclared = (plugin: string, name: string) =>
  new Error(`${plugin} handles ${name}, which nothing declares`)

// Two plugins' `./effects` handling one name: a run is done once, by one.
let twice = (name: string, plugins: string[]) =>
  new Error(`${name} is handled by both ${plugins.join(' and ')}`)

/** Load only the roles served, then assemble once the host can lend storage. */
export let assembly = async (
  config: Config,
  roles: readonly Role[],
  load: Load,
  opts: AssemblyOpts = {},
): Promise<Assembly> => {
  if (!roles.includes('graph')) {
    throw new Error('a host opens a graph — its roles include graph')
  }
  let plugins = opts.plugins ??
    (config.plugins ?? []).map((p): [string, Options] => [used(p), given(p)])
  let observed = opts.observed ??
    compositionAnatomy(plugins.map(([p]) => p), roles, ROLES)
  let part = opts.part
  let observedLoad: Load = async (plugin, name) => {
    observed.attempted(plugin, name)
    let loaded = await load(plugin, name)
    observed.loaded(plugin, name, loaded !== null)
    return loaded
  }
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
    roles.includes(role)
      ? taking(plugins, name, observedLoad)
      : Promise.resolve([])
  part?.('facets')
  await load.together?.(plugins.flatMap(([plugin]) =>
    [
      'vocab' as const,
      'graph' as const,
      ...roles.includes('effects') ? ['effects'] as const : [],
      ...roles.includes('web') ? ['routes', 'ui'] as const : [],
      ...services.includes(plugin) ? ['service'] as const : [],
    ].map((name) => [plugin, name] as const)
  ))
  let [vocabs, graphs, watched, served, dressed, running] = await Promise.all([
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
  ])
  part?.('vocabulary')
  let words = wordsOf(vocabs)
  let { docs, vocab, derived } = words
  part?.('anatomy')
  observed.declarations(docs, vocab)

  return {
    words,
    bind: (binding) => {
      let { host: lent, actor: self, process, readOnly } = binding
      let g: Graph | undefined
      let store: Host['storage'] | undefined
      let watching: Effects | undefined
      let answering: Handler | undefined
      let paths: Route[] = []
      let filters: Filter[] = []
      let made: NamedTool[] | undefined
      let ranked: Search | undefined
      let replying: Reply | undefined
      let calls: Runner | undefined
      let host: Host = {
        ...lent,
        config,
        roles,
        vocab,
        derived,
        anatomy: observed.read,
        observe: observed.observe,
        ui: gather(dressed.map(([facet]) => facet)),
        who: (request) => authenticate(request),
        feed: (each) => {
          let stops = graphs.flatMap(([r, options]) =>
            r.feed ? [r.feed(host, options)(each)] : []
          )
          return () => stops.forEach((stop) => stop())
        },
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
          if (!made) throw new Error('the tools are not built yet')
          return made
        },
        get runner() {
          if (!calls) throw new Error('the tool runner is not built yet')
          return calls
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
      part?.('install')
      if (binding.install) {
        binding.install(host)
        for (let [r, options] of graphs) r.install?.(host, options)
      }
      part?.('effects')
      let fx = watching = binding.effects(
        host,
        vocabs.flatMap(([v, options]) =>
          effectsIn(v.docs ?? []).filter((e) =>
            e.option && options[e.option] !== true
          ).map((e) => e.name)
        ),
      )
      part?.('plugins')
      let contributed = graphs.flatMap(([r, options, plugin]) => {
        let made = r.plugins?.(host, options) ?? []
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
        throw new Error(
          '`numbers` prints ids like T-7, and no plugin in this config reads ' +
            'one back — add @yaks/id to plugins',
        )
      }
      part?.('graph')
      g = (binding.graph ?? graph)({
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
        let declared = new Set(
          vocabs.flatMap(([v]) => effectsIn(v.docs ?? []).map((e) => e.name)),
        )
        let code: Handlers = {}
        let by = new Map<string, string>()
        for (let [mod, options, plugin] of watched) {
          for (
            let [name, run] of Object.entries(
              mod.effects?.(host, options) ?? {},
            )
          ) {
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
      let meanings = graphs.flatMap(([r, options]) =>
        r.meaning ? [r.meaning(host, options)] : []
      )
      if (meanings.length > 1) {
        throw new Error(
          'more than one meaning index answers search',
        )
      }
      ranked = binding.search?.(host, meanings[0])
      // The generic tools belong to this graph, not to any transport: they are
      // declared in @yaks/graph's own vocabulary and implemented there, and a
      // host has a graph whether or not anything is listening. So the tier is
      // assembled here beside the plugins' own, in the form the vocabulary
      // declares, and a transport that needs them in its own form restates them
      // (@yaks/mcp `core`).
      //
      // A plugin's own tools are listed from its vocabulary and run by its
      // `./tools`, imported the first time one of them is called.
      let generic = tier({ search: ranked, keywords: vocab.keywords })
      part?.('tools')
      observed.tier(generic)
      let tools = made = [
        ...generic,
        ...vocabs.flatMap(([v, options, plugin]) =>
          loadTools(v.docs ?? [], async () => {
            let code = await observedLoad(plugin, 'tools')
            let runs = code?.runs?.(host, options) ?? {}
            let declarations = toolsIn(v.docs ?? [])
            let names = declarations.map((d) => d.name ?? toolName(d))
            let joined = declarations.filter((d) =>
              typeof (runs[d.name ?? toolName(d)] ??
                runs[[d.noun, d.verb].filter(Boolean).join('_')]) == 'function'
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
      part?.('runner')
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
        ...process ? { process } : {},
        report: (error, call, tool) =>
          readOnly ? console.error(error) : host.report?.(error, {
            actor: call.$actor ?? self ?? undefined,
            during: { entity: call.entity.eid, kind: 'call', process: host.me },
            tags: { tool },
          }),
        ...replying ? { reply: replying } : {},
      })
      if (effecting) {
        let due: Handlers[string] = (e) => run.due(e.entity.eid)
        fx.handle(Object.fromEntries(run.rules.map((r) => [r.rule.name, due])))
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
        throw new Error(`${hosts.length} plugins host routes — a host has one`)
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
      return { host, services: duties }
    },
  }
}
