// One Worker's already-built store, never the native host's plugin roster.
// The caller supplies the arrays it actually composed. No factory, registry
// callback, tool, graph query or binding is evaluated to answer a snapshot.
import {
  type Anatomy,
  anatomy,
  anatomyData,
  anatomyDocuments,
  type AnatomyEffect,
  anatomyPlugin,
  type AnatomySeed,
  type AnatomySource,
  type AnatomyTool,
} from '@yaks/code/anatomy'
import type { Effects, Slot } from '@yaks/effects'
import type { NamedTool, Plugin as GraphPlugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import type { Tools } from '@yaks/tools/declared'
import type { Plugin } from './plugin.ts'

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

/** Capture exists per incarnation. Shared vocabulary caches hold no loading state. */
export let workerAnatomy = (vocab: Vocab) => {
  let source: AnatomySource = {
    host: 'worker/store',
    scope: 'worker',
    packages: [],
    roles: [],
    facets: [],
    comps: [],
    tools: [],
    commands: [],
    effects: [],
    rules: [],
    hooks: [],
    // Anonymous Worker doors are not a method/path registry. Nor are the
    // analytics views plugin, a prompt file, or Env evidence of these groups.
    observed: {
      packages: false,
      roles: false,
      facets: false,
      comps: false,
      tools: false,
      commands: false,
      effects: false,
      rules: false,
      hooks: false,
      routes: false,
      views: false,
      inspectViews: false,
      tui: false,
      kits: false,
      themes: false,
      skills: false,
      secrets: false,
    },
  }
  let loaded = new Set<string>()
  let owner = (name: string) => {
    let row = source.packages!.find((p) => p.name == name)
    if (!row) {
      row = {
        name,
        configured: false,
        declared: true,
        loaded: true,
        bound: true,
      }
      source.packages!.push(row)
    }
    return row
  }
  let facet = (name: string, part: string, bound = true) => {
    owner(name)
    let row = source.facets!.find((f) => f.package == name && f.name == part)
    if (!row) {
      row = {
        name: part,
        package: name,
        selected: true,
        attempted: true,
        declared: true,
        loaded: true,
        bound,
      }
      source.facets!.push(row)
    } else row.bound ||= bound
  }
  let documents = () => {
    if (loaded.has('vocab')) return
    let projected = anatomyDocuments(vocab.docs)
    source.comps = projected.comps.map((c) => ({ ...c, bound: true }))
    source.tools = projected.tools
    source.effects = projected.effects
    source.rules = [
      ...projected.rules.map((r) => ({ ...r, bound: true })),
      ...source.rules!,
    ]
    for (let c of source.comps) {
      if (c.extends) continue
      c.rules = anatomyData(vocab.comp(c.name))
      c.indexes = vocab.indexes(c.name)
      c.identity = vocab.identity(c.name)
      c.assocs = vocab.assocs().filter(([, a]) => a.comp == c.name)
        .map(([name, a]) => ({ name, prop: a.prop }))
      for (let p of c.props) p.rules = anatomyData(vocab.prop(c.name, p.name))
    }
    for (
      let rows of [source.comps, source.tools, source.effects, projected.rules]
    ) {
      for (let row of rows) {
        row.package ??= 'worker/store'
        facet(row.package, 'vocab')
      }
    }
    source.observed!.packages =
      source.observed!.facets =
      source.observed!
        .comps =
        true
    loaded.add('vocab')
  }
  let graph = (plugins: GraphPlugin[], domains: Plugin[]) => {
    documents()
    source.observed!.roles =
      source.observed!.rules =
      source.observed!.hooks =
        true
    source.roles!.push({
      name: 'graph',
      facets: ['vocab', 'rules'],
      declared: true,
      loaded: true,
      bound: true,
    })
    plugins.forEach((p, i) => {
      let name = text(p, 'name') ?? 'worker/store'
      let projected = anatomyPlugin(name, p, String(i))
      source.rules!.push(...projected.rules)
      source.hooks!.push(...projected.hooks)
      facet(name, 'rules')
    })
    // rulesOf(domains) was passed to the actual yak/rules plugin. Record its
    // original owning declarations, not the resource values or generated patches.
    for (let p of domains) {
      let rules = value(p, 'rules')
      if (!Array.isArray(rules) || !rules.length) continue
      let name = text(p, 'name')
      if (!name) continue
      let projected = anatomyPlugin(name, { name, rules }, 'domain')
      source.rules!.push(...projected.rules)
      facet(name, 'rules')
    }
  }
  let commands = (declared: Tools, tools: NamedTool[]) => {
    documents()
    source.observed!.tools = source.observed!.commands = true
    source.commands = entries(declared).map(([name, d]) => ({
      name,
      package: 'worker/store',
      facet: 'commands',
      declared: true,
      loaded: true,
      bound: tools.some((t) => t.name == name),
      description: text(d, 'description'),
      schema: {
        type: 'object',
        properties: anatomyData(value(d, 'input')),
        required: anatomyData({ required: value(d, 'required') }).required ??
          [],
      },
    }))
    source.tools = source.tools!.filter((t) => t.facet != 'commands')
    for (let t of source.tools) t.loaded = t.bound = false
    for (let t of tools) {
      let name = text(t, 'name')
      if (!name) continue
      let existing = source.tools!.find((r) => r.name == name)
      if (existing) {
        existing.loaded = existing.bound = true
        existing.inputSchema = anatomyData(value(t, 'inputSchema'))
        existing.hints = hints(t)
      } else {
        let row: AnatomySeed<AnatomyTool> = {
          name,
          package: 'worker/store',
          facet: 'commands',
          loaded: true,
          bound: true,
          inputSchema: anatomyData(value(t, 'inputSchema')),
          description: text(t, 'description'),
          hints: hints(t),
        }
        source.tools!.push(row)
      }
    }
    facet('worker/store', 'commands')
  }
  let slotOwners = new Map<string, string>()
  let registration = (name: string, registry: Effects) => {
    // This is invoked before the real callback; the returned observer after it.
    // Keep only function identity locally during registration, never in the DTO.
    let before = new Map(registry.slots().map((s) => [s.id, s.run]))
    return () => {
      for (let s of registry.slots()) {
        if (!before.has(s.id) || before.get(s.id) != s.run) {
          slotOwners.set(s.id, name)
        }
      }
      facet(name, 'effects')
    }
  }
  let effects = (slots: Slot[], host = 'worker/store') => {
    documents()
    source.observed!.effects = true
    source.roles!.push({
      name: 'effects',
      facets: ['effects'],
      declared: true,
      loaded: true,
      bound: true,
    })
    source.effects = source.effects!.filter((e) => !e.registration)
    let declared = new Map(source.effects!.map((e) => [e.name, e]))
    for (let [i, s] of slots.entries()) {
      let name = text(s, 'id')
      if (!name) continue
      let handler = slotOwners.get(name) ?? host
      let run = typeof value(s, 'run') == 'function'
      let effect = declared.get(name)
      if (effect && value(s, 'effect')) {
        effect.loaded = run
        effect.bound = run
        if (run) {
          effect.handler = handler
          facet(handler, 'effects')
        } else effect.handler = undefined
        continue
      }
      let row: AnatomySeed<AnatomyEffect> = {
        name,
        package: handler,
        facet: 'effects',
        key: String(i),
        registration: true,
        declared: false,
        loaded: run,
        bound: run,
        noop: false,
        description: text(s, 'doc'),
        handler: run ? handler : undefined,
        triggers: anatomyData({
          kind: value(s, 'kind'),
          comp: value(s, 'comp'),
          props: value(s, 'props'),
          watch: value(s, 'watch'),
          gone: value(s, 'gone'),
        }),
      }
      source.effects!.push(row)
      facet(handler, 'effects')
    }
  }
  let read = (): Anatomy => {
    documents()
    return anatomy(source)
  }
  return { graph, commands, registration, effects, read }
}
