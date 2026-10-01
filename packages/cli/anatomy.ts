/** Per-composition evidence, separate from the shared vocabulary cache. */
import {
  type Anatomy,
  anatomy,
  anatomyData,
  anatomyDocuments,
  type AnatomyObservation,
  anatomyPlugin,
  type AnatomySeed,
  type AnatomySource,
} from '@yaks/code/anatomy'
import type { NamedTool, Plugin } from '@yaks/graph'
import type { Vocab, VocabDoc } from '@yaks/vocab'

// Options have not been revealed yet. Inspect data descriptors only: a getter
// on resolved options is a vault read, not a secret-name declaration.
export let secretNames = (
  source: unknown,
  seen = new Set<object>(),
): string[] => {
  if (!source || typeof source != 'object' || seen.has(source)) return []
  seen.add(source)
  let ds = Object.getOwnPropertyDescriptors(source)
  let keys = Object.keys(ds).filter((k) => ds[k].enumerable)
  let secret = ds.secret
  if (
    keys.length == 1 && keys[0] == 'secret' && secret && 'value' in secret &&
    typeof secret.value == 'string'
  ) return [secret.value]
  return keys.flatMap((k) =>
    'value' in ds[k] ? secretNames(ds[k].value, seen) : []
  )
}

type Facet = AnatomySeed<Anatomy['facets'][number]>
type Tool = AnatomySeed<Anatomy['tools'][number]>
let hints = [
  'title',
  'options',
  'readOnly',
  'destructive',
  'idempotent',
  'openWorld',
  'surfaces',
  'roles',
]

/** Capture only already-made contributions; none of these methods runs code. */
export let nativeAnatomy = (
  packages: string[],
  roles: readonly string[],
  common: Record<string, readonly string[]>,
  secrets: { name: string; package: string }[] = [],
) => {
  let source: AnatomySource = {
    host: 'native',
    scope: 'native',
    observed: {
      packages: true,
      roles: true,
      facets: true,
      comps: true,
      tools: true,
      effects: true,
      rules: true,
      hooks: true,
      routes: true,
      secrets: true,
      commands: false,
      views: false,
      inspectViews: false,
      tui: false,
      kits: false,
      themes: false,
      skills: false,
    },
    packages: packages.map((name) => ({
      name,
      configured: true,
      declared: true,
    })),
    roles: [...Object.keys(common), ...packages].map((name) => ({
      name,
      ...common[name] ? {} : { package: name },
      facets: [...(common[name] ?? ['service'])],
      declared: true,
      loaded: roles.includes(name),
      bound: roles.includes(name),
    })),
    secrets: secrets.map((s) => ({ ...s, declared: true })),
  }
  let facets = new Map<string, Facet>()
  let forFacet = (owner: string, name: string): Facet => {
    let key = `${owner}/${name}`
    let had = facets.get(key)
    if (had) return had
    let selected =
      Object.entries(common).some(([r, fs]) =>
        roles.includes(r) && fs.includes(name)
      ) ||
      (name == 'service' && roles.includes(owner))
    let made: Facet = { name, package: owner, selected, attempted: false }
    facets.set(key, made)
    return made
  }
  for (let owner of packages) {
    for (
      let name of [
        'vocab',
        'rules',
        'tools',
        'effects',
        'routes',
        'ui',
        'service',
        'cli',
        'views',
        'tui',
      ]
    ) {
      forFacet(owner, name)
    }
  }
  let registered = new Set<string>()
  let vocabulary = new Set<string>()
  let ownerOf = (name: string) => {
    let had = source.packages!.find((p) => p.name == name)
    if (had) return had
    let made = {
      name,
      configured: false,
      declared: true,
      loaded: false,
      bound: false,
    }
    source.packages!.push(made)
    return made
  }
  let binding = (owner: string, name: string) => {
    let f = forFacet(owner, name)
    f.declared = f.loaded = f.bound = true
    let p = ownerOf(owner)
    p.loaded = p.bound = true
  }
  let readValue = (input: unknown, name: string): unknown => {
    if (!input || typeof input != 'object') return undefined
    let d = Object.getOwnPropertyDescriptor(input, name)
    return d && 'value' in d ? d.value : undefined
  }
  let entries = (input: unknown): [string, unknown][] => {
    if (!input || typeof input != 'object') return []
    return Object.entries(Object.getOwnPropertyDescriptors(input))
      .filter(([, d]) => d.enumerable && 'value' in d)
      .map(([k, d]) => [k, d.value])
  }
  let values = (input: unknown): unknown[] =>
    Array.isArray(input) ? entries(input).map(([, v]) => v) : []
  let observe = (o: AnatomyObservation) => {
    let f = forFacet(o.package, o.facet)
    f.attempted = true
    f.loaded = o.loaded
    if (!o.loaded) return
    f.declared = true
    ownerOf(o.package).loaded = true
    if (o.bound) binding(o.package, o.facet)
    let common = {
      package: o.package,
      facet: o.facet,
      declared: true,
      loaded: true,
      bound: o.bound,
    }
    if (o.facet == 'ui') {
      for (let group of ['kits', 'themes'] as const) {
        source.observed![group] = true
        source[group] = [
          ...source[group]?.filter((p) => p.package != o.package) ?? [],
          ...entries(readValue(o.value, group)).map(([name]) => ({
            ...common,
            name,
          })),
        ]
      }
      return
    }
    if (o.facet == 'cli') {
      source.observed!.commands = true
      source.commands = [
        ...source.commands?.filter((p) => p.package != o.package) ?? [],
        ...values(readValue(o.value, 'commands')).flatMap((c, i) => {
          let name = readValue(c, 'name')
          if (typeof name != 'string') return []
          let description = readValue(c, 'description')
          return [{
            ...common,
            name,
            key: String(i),
            schema: anatomyData(readValue(c, 'inputSchema')),
            ...typeof description == 'string' ? { description } : {},
          }]
        }),
      ]
      return
    }
    for (
      let group of o.facet == 'tui'
        ? ['tui'] as const
        : ['views', 'inspectViews'] as const
    ) {
      let raw = group == 'inspectViews'
        ? readValue(o.value, 'inspectViews')
        : readValue(readValue(o.value, 'views'), 'renderers')
      // A module without inspectViews is not evidence about its page's own
      // curated registry; an exported empty list is evidence of no additions.
      if (raw === undefined) continue
      source.observed![group] = true
      source[group] = [
        ...source[group]?.filter((p) => p.package != o.package) ?? [],
        ...values(raw).flatMap((r, i) => {
          let name = readValue(r, 'view')
          if (typeof name != 'string') return []
          return [{ ...common, name, key: String(i) }]
        }),
      ]
    }
  }
  let declarations = (docs: VocabDoc[], vocab: Vocab) => {
    let projected = anatomyDocuments(docs)
    source.comps = projected.comps
    source.tools = projected.tools
    source.effects = projected.effects
    source.rules = projected.rules
    for (let doc of docs) {
      if (!doc.package) continue
      vocabulary.add(doc.package)
      let f = forFacet(doc.package, 'vocab')
      f.declared = f.loaded = true
      ownerOf(doc.package).loaded = true
    }
    for (let c of source.comps ?? []) {
      let info = vocab.comp(c.name)
      if (info && !c.extends) c.rules = anatomyData(info)
      for (let p of c.props) {
        if (!c.extends) p.rules = anatomyData(vocab.prop(c.name, p.name))
      }
      c.refs = [
        ...new Set(c.props.flatMap((p) => {
          let ref = vocab.prop(c.name, p.name)?.ref
          p.refs = ref ? [ref] : p.refs
          return p.refs
        })),
      ]
      if (!c.extends) {
        c.indexes = vocab.indexes(c.name)
        c.identity = vocab.identity(c.name)
        c.assocs = vocab.assocs().filter(([, a]) => a.comp == c.name)
          .map(([name, a]) => ({ name, prop: a.prop }))
      }
    }
  }
  let tool = (
    owner: string,
    t: Omit<NamedTool, 'run'>,
    tier?: string,
  ): Tool => {
    // Do not traverse a tool object: even a discarded field could be its host.
    let ds = Object.getOwnPropertyDescriptors(t)
    let data = anatomyData(Object.fromEntries(
      ['name', 'inputSchema', 'outputSchema', 'description', ...hints].flatMap(
        (k) => {
          let d = ds[k]
          return d && 'value' in d ? [[k, d.value]] : []
        },
      ),
    ))
    let kept = Object.fromEntries(
      hints.flatMap((k) => data[k] === undefined ? [] : [[k, data[k]]]),
    )
    return {
      name: typeof data.name == 'string' ? data.name : '',
      package: owner,
      facet: 'tools',
      inputSchema: anatomyData(data.inputSchema),
      ...data.outputSchema
        ? { outputSchema: anatomyData(data.outputSchema) }
        : {},
      ...typeof data.description == 'string'
        ? { description: data.description }
        : {},
      hints: kept,
      ...tier ? { tier } : {},
      declared: true,
      loaded: !!tier,
      bound: !!tier,
    }
  }
  return {
    read: (): Anatomy => anatomy({ ...source, facets: [...facets.values()] }),
    observe,
    attempted: (owner: string, name: string) => {
      forFacet(owner, name).attempted = true
    },
    loaded: (owner: string, name: string, present: boolean) => {
      let f = forFacet(owner, name)
      f.loaded = f.declared = present
      if (present) ownerOf(owner).loaded = true
    },
    binding,
    declarations,
    graph: (owner: string, plugins: Plugin[]) => {
      plugins.forEach((p, i) => {
        let made = anatomyPlugin(owner, p, String(i))
        source.rules = [
          ...source.rules ?? [],
          ...made.rules.map((r) => ({ ...r, bound: false })),
        ]
        source.hooks = [
          ...source.hooks ?? [],
          ...made.hooks.map((h) => ({ ...h, bound: false })),
        ]
      })
      if (plugins.length) {
        registered.add(owner)
        ownerOf(owner).loaded = true
      }
    },
    graphed: () => {
      for (let r of source.rules ?? []) r.bound = true
      for (let h of source.hooks ?? []) h.bound = true
      for (let c of source.comps ?? []) c.bound = true
      for (let owner of vocabulary) binding(owner, 'vocab')
      for (let owner of registered) binding(owner, 'rules')
    },
    tier: (tools: NamedTool[]) => {
      ownerOf('@yaks/graph')
      binding('@yaks/graph', 'tools')
      source.tools = [
        ...source.tools ?? [],
        ...tools.map((t) => tool('@yaks/graph', t, 'graph')),
      ]
    },
    runs: (owner: string, names: string[], joined: string[]) => {
      if (joined.length) binding(owner, 'tools')
      for (let t of source.tools ?? []) {
        if (t.package != owner) continue
        t.loaded = names.includes(t.name)
        t.bound = joined.includes(t.name)
      }
    },
    effects: (handlers: Map<string, string>, serving: boolean) => {
      for (let e of source.effects ?? []) {
        e.handler = handlers.get(e.name)
        e.loaded = !!e.handler
        e.bound = serving
        e.noop = serving && !e.handler
        if (e.handler) binding(e.handler, 'effects')
      }
    },
    due: (names: string[]) => {
      for (let e of source.effects ?? []) {
        if (!names.includes(e.name)) continue
        e.handler = '@yaks/tools'
        e.noop = false
        e.loaded = e.bound = true
      }
      if (names.length) binding('@yaks/tools', 'effects')
    },
    routes: (owner: string, routes: { method: string; path: string }[]) => {
      source.routes = [
        ...source.routes ?? [],
        ...routes.map((r, i) => ({
          name: `${r.method} ${r.path}`,
          package: owner,
          facet: 'routes',
          key: String(i),
          method: r.method,
          path: r.path,
          loaded: true,
          bound: true,
        })),
      ]
      binding(owner, 'routes')
    },
  }
}
