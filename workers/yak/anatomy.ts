// The store's assembly supplies its composition. This adapter adds only the
// Worker's host hooks, command runner and effect registrations, without calling
// a factory, tool, graph query or binding to answer an anatomy read.
import {
  type Anatomy,
  anatomy,
  anatomyData,
  type AnatomyEffect,
  type AnatomySeed,
  type AnatomySource,
} from '@yaks/code/anatomy'
import type { Effects, Slot } from '@yaks/effects'
import type { NamedTool, Plugin as GraphPlugin } from '@yaks/graph'
import { compositionAnatomy } from '@yaks/host/anatomy'
import { type Config, facetsOf, used } from '@yaks/host/config'
import { ROLES } from '@yaks/host/roles'
import type { Tools } from '@yaks/tools/declared'

let value = (input: unknown, key: string): unknown => {
  if (!input || typeof input != 'object') return undefined
  let d = Object.getOwnPropertyDescriptor(input, key)
  return d && 'value' in d ? d.value : undefined
}
let entries = (input: unknown): [string, unknown][] => {
  if (!input || typeof input != 'object') return []
  return Object.entries(Object.getOwnPropertyDescriptors(input))
    .filter(([, d]) => d.enumerable && 'value' in d)
    .map(([key, d]) => [key, d.value])
}
let held = <T extends object>(input: T): T =>
  Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(input))
        .filter(([, d]) => 'value' in d),
    ),
  ) as T
let text = (input: unknown, key: string) => {
  let v = value(input, key)
  return typeof v == 'string' ? v : undefined
}
let hints = (input: unknown) =>
  anatomyData(Object.fromEntries(
    ['title', 'readOnly', 'destructive', 'idempotent', 'openWorld']
      .flatMap((key) => {
        let v = value(input, key)
        return v === undefined ? [] : [[key, v]]
      }),
  ))

/** Per-incarnation evidence; shared vocabulary caches hold no loading state. */
export let workerAnatomy = (config: Config) => {
  let capture = compositionAnatomy(
    (config.plugins ?? []).map((p) => ({
      name: used(p),
      facets: facetsOf(p),
    })),
    ['graph', 'effects'],
    ROLES,
    [],
    { host: 'worker/store', scope: 'worker' },
  )
  let contributed = new Set<GraphPlugin>()
  let handlers = new Map<string, string>()
  let composition = {
    ...capture,
    read: (): Anatomy => read(),
    graph: (owner: string, plugins: GraphPlugin[]) => {
      for (let plugin of plugins) contributed.add(plugin)
      capture.graph(owner, plugins)
    },
    effects: (owners: Map<string, string>, serving: boolean) => {
      handlers = new Map(owners)
      capture.effects(owners, serving)
    },
  }
  let source: AnatomySource = {
    host: 'worker/store',
    scope: 'worker',
    tools: [],
    commands: [],
    effects: [],
  }
  let graph = (plugins: GraphPlugin[]) => {
    for (let p of plugins) {
      if (contributed.has(p)) continue
      capture.graph(text(p, 'name') ?? 'worker/store', [p])
    }
    capture.graphed()
  }
  let declared: Tools | undefined
  let tools: NamedTool[] = []
  let commandNames = new Set<string>()
  let commands = (definitions: Tools, bound: NamedTool[]) => {
    declared = definitions
    tools = bound
    capture.binding('worker/store', 'commands')
    for (let [name] of entries(definitions)) commandNames.add(name)
  }
  let slotOwners = new Map<string, string>()
  let registration = (owner: string, registry: Effects) => {
    let before = new Map(registry.slots().map((s) => [s.id, s.run]))
    return () => {
      for (let s of registry.slots()) {
        if (!before.has(s.id) || before.get(s.id) != s.run) {
          slotOwners.set(s.id, owner)
        }
      }
    }
  }
  let slots: Slot[] | undefined
  let effects = (registered: Slot[]) => {
    slots = registered.map(held)
    let owners = new Map(handlers)
    for (let s of slots) {
      let owner = slotOwners.get(s.id) ?? handlers.get(s.id) ?? 'worker/store'
      if (typeof value(s, 'run') != 'function') continue
      capture.binding(owner, 'effects')
      if (value(s, 'effect')) owners.set(s.id, owner)
    }
    capture.effects(owners, true)
  }
  let read = (): Anatomy => {
    let base = capture.read()
    source.tools = []
    // Routes and secrets belong to the Worker's router and Env boundary;
    // neither was composed by this store's graph/effects roles.
    base.observed!.routes = base.observed!.secrets = false
    if (declared) {
      base.observed!.commands = true
      // Store tools retain the assembly's loading evidence. A runner's lazy
      // wrapper is not evidence of an imported package run.
      for (let name of commandNames) {
        let bound = value(declared, name) &&
          tools.find((t) => text(t, 'name') == name)
        let existing = base.tools.find((t) => t.name == name)
        if (existing) existing.loaded = existing.bound = !!bound
        if (!bound) continue
        let metadata = {
          inputSchema: anatomyData(value(bound, 'inputSchema')),
          description: text(bound, 'description'),
          hints: hints(bound),
        }
        if (existing) Object.assign(existing, metadata)
        else {source.tools.push({
            name,
            package: 'worker/store',
            facet: 'commands',
            loaded: true,
            bound: true,
            ...metadata,
          })}
      }
      source.commands = entries(declared).map(([name, d]) => ({
        name,
        package: 'worker/store',
        facet: 'commands',
        declared: true,
        loaded: true,
        bound: tools.some((t) => text(t, 'name') == name),
        description: text(d, 'description'),
        schema: {
          type: 'object',
          properties: anatomyData(value(d, 'input')),
          required: anatomyData({ required: value(d, 'required') }).required ??
            [],
        },
      }))
    }
    source.effects = []
    for (let [i, s] of (slots ?? []).entries()) {
      let name = text(s, 'id')
      if (!name) continue
      let run = typeof value(s, 'run') == 'function'
      let owner = slotOwners.get(name) ?? handlers.get(name) ?? 'worker/store'
      if (!value(s, 'effect')) {
        let row: AnatomySeed<AnatomyEffect> = {
          name,
          package: owner,
          facet: 'effects',
          key: String(i),
          registration: true,
          declared: false,
          loaded: run,
          bound: run,
          noop: false,
          description: text(s, 'doc'),
          handler: run ? owner : undefined,
          triggers: anatomyData({
            kind: value(s, 'kind'),
            comp: value(s, 'comp'),
            props: value(s, 'props'),
            watch: value(s, 'watch'),
            gone: value(s, 'gone'),
          }),
        }
        source.effects.push(row)
      }
    }
    // Project only the host's additions. The assembly retains all graph
    // registration ids and supplies the packages and facets these additions join.
    let owners = new Set([
      ...source.commands!,
      ...source.tools!,
      ...source.effects,
    ].map((p) => p.package))
    let extra = anatomy({
      ...source,
      packages: base.packages.filter((p) => owners.has(p.name)),
      facets: base.facets.filter((p) => owners.has(p.package)),
    })
    for (
      let group of [
        'commands',
        'tools',
        'effects',
      ] as const
    ) {
      Object.assign(base, {
        [group]: [...new Map(
          [...base[group], ...extra[group]].map((p) => [p.id, p]),
        ).values()],
      })
    }
    base.edges = [...new Map(
      [...base.edges, ...extra.edges]
        .map((e) => [e.id, e]),
    ).values()]
    return base
  }
  return { composition, graph, commands, registration, effects, read }
}
