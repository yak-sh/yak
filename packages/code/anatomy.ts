/** Value-free composition metadata shared by native hosts, workers and pages. */

/** A declaration is not evidence that its implementation was imported or bound. */
export type AnatomyPart = {
  id: string
  name: string
  package?: string
  facet?: string
  declared: boolean
  loaded: boolean
  bound: boolean
  description?: string
}

export type AnatomyPackage = AnatomyPart & { configured: boolean }
export type AnatomyRole = AnatomyPart & { facets: string[] }
export type AnatomyFacet = AnatomyPart & {
  selected: boolean
  /** A selected facet which has not been attempted is not known to be absent. */
  attempted: boolean
}
export type AnatomyProp = {
  name: string
  schema: Record<string, unknown>
  refs: string[]
  rules?: Record<string, unknown>
}
export type AnatomyComp = AnatomyPart & {
  schema: Record<string, unknown>
  props: AnatomyProp[]
  extends: boolean
  refs: string[]
  before: string[]
  rules: Record<string, unknown>
  indexes?: { props: string[]; unique: boolean; present?: string[] }[]
  identity?: string[]
  assocs?: { name: string; prop: string }[]
}
export type AnatomyTool = AnatomyPart & {
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  tier?: string
  hints?: Record<string, unknown>
}
export type AnatomyCommand = AnatomyPart & {
  schema?: Record<string, unknown>
  usage?: string
}
export type AnatomyEffect = AnatomyPart & {
  handler?: string
  noop: boolean
  triggers?: Record<string, unknown>
  /** A worker registration callback is not a named effect handler. */
  registration?: boolean
}
export type AnatomyRule = AnatomyPart & {
  hooks: string[]
  kind?: 'plugin' | 'code' | 'data'
  match?: string
  phase?: string
  before?: string[]
  optimistic?: boolean
  requests?: string[]
  resources?: string[]
  capabilities?: string[]
}
export type AnatomyRoute = AnatomyPart & { method: string; path: string }
export type AnatomySkill = AnatomyPart & { path?: string }
export type AnatomyEdge = { id: string; from: string; to: string; kind: string }
export type AnatomyGroup =
  | 'packages'
  | 'roles'
  | 'facets'
  | 'comps'
  | 'tools'
  | 'commands'
  | 'effects'
  | 'rules'
  | 'hooks'
  | 'routes'
  | 'views'
  | 'inspectViews'
  | 'tui'
  | 'kits'
  | 'themes'
  | 'skills'
  | 'secrets'

/** No graph rows, plugin options, handler functions or secret values. */
export type Anatomy = {
  version: 1
  host: string
  /** This is one composition, not evidence of what another host has loaded. */
  scope?: 'native' | 'worker' | 'static'
  /** False means the category is outside this adapter's observation, not absent. */
  observed?: Partial<Record<AnatomyGroup, boolean>>
  packages: AnatomyPackage[]
  roles: AnatomyRole[]
  facets: AnatomyFacet[]
  comps: AnatomyComp[]
  tools: AnatomyTool[]
  commands: AnatomyCommand[]
  effects: AnatomyEffect[]
  rules: AnatomyRule[]
  hooks: AnatomyPart[]
  routes: AnatomyRoute[]
  views: AnatomyPart[]
  inspectViews: AnatomyPart[]
  tui: AnatomyPart[]
  kits: AnatomyPart[]
  themes: AnatomyPart[]
  skills: AnatomySkill[]
  secrets: AnatomyPart[]
  edges: AnatomyEdge[]
}

/** Adapters pass metadata they already observed, never a host or its options. */
export type AnatomySeed<T extends AnatomyPart = AnatomyPart> =
  & Omit<T, 'id' | 'declared' | 'loaded' | 'bound'>
  & {
    /** Distinguishes repeated registrations, and additive schema documents. */
    key?: string
    declared?: boolean
    loaded?: boolean
    bound?: boolean
  }
export type AnatomySource =
  & {
    host: string
    scope: NonNullable<Anatomy['scope']>
    observed?: Anatomy['observed']
  }
  & {
    [K in AnatomyGroup]?: AnatomySeed<Anatomy[K][number]>[]
  }

/** IDs depend on provenance and registration identity, never on loading state. */
export let anatomyId = (
  group: AnatomyGroup | 'edges',
  owner = '',
  name = '',
  key = '',
): string => [group, owner, name, key].map(encodeURIComponent).join(':')

// JSON metadata may include authored defaults. Accessors, class instances and
// executable values are not metadata: in particular, reading an accessor must
// never become an accidental vault read while preparing a page's snapshot.
let json = (value: unknown, seen = new Set<object>()): unknown => {
  if (value === null || typeof value == 'string' || typeof value == 'boolean') {
    return value
  }
  if (typeof value == 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (!value || typeof value != 'object' || seen.has(value)) return undefined
  let proto = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    return undefined
  }
  seen.add(value)
  let descriptors = Object.getOwnPropertyDescriptors(value)
  let out: Record<string, unknown> = {}
  for (let [key, d] of Object.entries(descriptors)) {
    if (!d.enumerable || !('value' in d)) continue
    let kept = json(d.value, seen)
    if (kept !== undefined) {
      Object.defineProperty(out, key, { value: kept, enumerable: true })
    }
  }
  seen.delete(value)
  return Array.isArray(value)
    ? Array.from({ length: value.length }, (_, i) => out[String(i)] ?? null)
    : out
}

/** Clone schema/declaration data without invoking getters or keeping functions. */
export let anatomyData = (value: unknown): Record<string, unknown> => {
  let kept = json(value)
  return kept && typeof kept == 'object' && !Array.isArray(kept)
    ? kept as Record<string, unknown>
    : {}
}

let GROUPS: AnatomyGroup[] = [
  'packages',
  'roles',
  'facets',
  'comps',
  'tools',
  'commands',
  'effects',
  'rules',
  'hooks',
  'routes',
  'views',
  'inspectViews',
  'tui',
  'kits',
  'themes',
  'skills',
  'secrets',
]
let TEXT = ['name', 'package', 'facet', 'description'] as const

let value = (source: unknown, key: string): unknown => {
  if (!source || typeof source != 'object') return undefined
  let d = Object.getOwnPropertyDescriptor(source, key)
  return d && 'value' in d ? d.value : undefined
}
let text = (source: unknown, key: string): string | undefined => {
  let kept = value(source, key)
  return typeof kept == 'string' ? kept : undefined
}
let strings = (source: unknown): string[] => {
  let kept = json(source)
  return Array.isArray(kept)
    ? kept.filter((s): s is string => typeof s == 'string')
    : []
}

// Even an adapter's seed is an allowlist boundary. Do not read through a
// caller's accessors, including its name, flags, group arrays or host label.
let part = (group: AnatomyGroup, seed: unknown): AnatomyPart | undefined => {
  let name = text(seed, 'name')
  if (name === undefined) return undefined
  let out: Record<string, unknown> = {
    id: anatomyId(group, text(seed, 'package'), name, text(seed, 'key')),
    name,
    declared: value(seed, 'declared') === true,
    loaded: value(seed, 'loaded') === true,
    bound: value(seed, 'bound') === true,
  }
  for (let key of TEXT) {
    if (group == 'secrets' && key == 'description') continue
    let kept = text(seed, key)
    if (kept !== undefined) out[key] = kept
  }
  let fields: Partial<Record<AnatomyGroup, string[]>> = {
    packages: ['configured'],
    roles: ['facets'],
    facets: ['selected', 'attempted'],
    comps: [
      'schema',
      'props',
      'extends',
      'refs',
      'before',
      'rules',
      'indexes',
      'identity',
      'assocs',
    ],
    tools: ['inputSchema', 'outputSchema', 'tier', 'hints'],
    commands: ['schema', 'usage'],
    effects: ['handler', 'noop', 'triggers', 'registration'],
    rules: [
      'hooks',
      'kind',
      'match',
      'phase',
      'before',
      'optimistic',
      'requests',
      'resources',
      'capabilities',
    ],
    routes: ['method', 'path'],
    skills: ['path'],
  }
  for (let key of fields[group] ?? []) {
    let kept = json(value(seed, key))
    if (kept !== undefined) out[key] = kept
  }
  if (group == 'packages') out.configured = out.configured === true
  if (group == 'roles') out.facets = strings(out.facets)
  if (group == 'facets') {
    out.selected = out.selected === true
    out.attempted = out.attempted === true
  }
  if (group == 'comps') {
    out.schema = anatomyData(out.schema)
    out.rules = anatomyData(out.rules)
    out.extends = out.extends === true
    out.before = strings(out.before)
    out.refs = strings(out.refs)
    out.props = (Array.isArray(out.props) ? out.props : []).flatMap((p) => {
      let name = text(p, 'name')
      return name === undefined ? [] : [{
        name,
        schema: anatomyData(value(p, 'schema')),
        refs: strings(value(p, 'refs')),
        ...value(p, 'rules') ? { rules: anatomyData(value(p, 'rules')) } : {},
      }]
    })
  }
  if (group == 'tools') {
    out.inputSchema = anatomyData(out.inputSchema)
    if (out.outputSchema !== undefined) {
      out.outputSchema = anatomyData(out.outputSchema)
    }
    if (out.hints !== undefined) out.hints = anatomyData(out.hints)
    if (typeof out.tier != 'string') delete out.tier
  }
  if (group == 'commands') {
    if (out.schema !== undefined) out.schema = anatomyData(out.schema)
    if (typeof out.usage != 'string') delete out.usage
  }
  if (group == 'effects') {
    out.noop = out.noop === true
    if (typeof out.handler != 'string') delete out.handler
    if (out.triggers !== undefined) out.triggers = anatomyData(out.triggers)
    if (out.registration !== undefined) {
      out.registration = out.registration === true
    }
  }
  if (group == 'rules') {
    out.hooks = strings(out.hooks)
    if (
      typeof out.kind != 'string' ||
      !['plugin', 'code', 'data'].includes(out.kind)
    ) delete out.kind
    for (let k of ['match', 'phase']) {
      if (typeof out[k] != 'string') delete out[k]
    }
    for (let k of ['before', 'requests', 'resources', 'capabilities']) {
      if (out[k] !== undefined) out[k] = strings(out[k])
    }
    if (out.optimistic !== undefined) out.optimistic = out.optimistic === true
  }
  if (group == 'skills' && typeof out.path != 'string') delete out.path
  if (group == 'routes') {
    out.method = typeof out.method == 'string' ? out.method : ''
    out.path = typeof out.path == 'string' ? out.path : ''
  }
  return out as AnatomyPart
}

/** The same value-free DTO and relationship mapper for every host adapter. */
export let anatomy = (source: AnatomySource): Anatomy => {
  let scope = text(source, 'scope')
  let observed = value(source, 'observed')
  let out = {
    version: 1 as const,
    host: text(source, 'host') ?? '',
    scope: scope == 'native' || scope == 'worker' ? scope : 'static',
    observed: Object.fromEntries(
      GROUPS.map((g) => [g, value(observed, g) === true]),
    ),
    edges: [] as AnatomyEdge[],
  } as Anatomy
  for (let group of GROUPS) {
    let seeds = value(source, group)
    let made = new Map<string, AnatomyPart>()
    // Array accessors are no more trustworthy than object accessors.
    if (Array.isArray(seeds)) {
      for (let d of Object.values(Object.getOwnPropertyDescriptors(seeds))) {
        if (!d.enumerable || !('value' in d)) continue
        let p = part(group, d.value)
        if (p) made.set(p.id, p)
      }
    }
    Object.assign(out, { [group]: [...made.values()] })
  }
  let packages = new Map(out.packages.map((p) => [p.name, p.id]))
  let facets = new Map(out.facets.map((p) => [`${p.package}/${p.name}`, p.id]))
  let comps = new Map(
    out.comps.filter((c) => !c.extends).map((c) => [c.name, c.id]),
  )
  let edges = new Map<string, AnatomyEdge>()
  let link = (
    from: string | undefined,
    to: string | undefined,
    kind: string,
  ) => {
    if (!from || !to || from == to) return
    let id = anatomyId('edges', from, to, kind)
    edges.set(id, { id, from, to, kind })
  }
  for (let group of GROUPS.filter((g) => g != 'packages' && g != 'roles')) {
    for (let p of out[group]) {
      link(packages.get(p.package ?? ''), p.id, 'contributes')
      link(facets.get(`${p.package}/${p.facet}`), p.id, 'provides')
    }
  }
  for (let r of out.roles) {
    for (let f of out.facets) {
      if (
        f.selected && r.facets.includes(f.name) &&
        (!r.package || r.package == f.package)
      ) {
        link(r.id, f.id, 'selects')
      }
    }
  }
  for (let c of out.comps) {
    if (c.extends) link(c.id, comps.get(c.name), 'extends')
    for (let before of c.before) link(c.id, comps.get(before), 'before')
    for (let p of c.props) {
      for (let ref of p.refs) link(c.id, comps.get(ref), `ref:${p.name}`)
    }
  }
  for (let t of out.tools.filter((t) => t.bound)) {
    link(facets.get(`${t.package}/tools`), t.id, 'binds')
  }
  for (let e of out.effects) {
    if (e.handler) link(facets.get(`${e.handler}/effects`), e.id, 'handles')
  }
  out.edges = [...edges.values()]
  return out
}

let entries = (source: unknown): [string, unknown][] => {
  if (!source || typeof source != 'object') return []
  return Object.entries(Object.getOwnPropertyDescriptors(source))
    .flatMap(([k, d]) =>
      d.enumerable && 'value' in d ? [[k, d.value] as [string, unknown]] : []
    )
}
let array = (source: unknown): unknown[] =>
  Array.isArray(source) ? entries(source).map(([, v]) => v) : []
let picked = (
  source: unknown,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(keys.flatMap((k) => {
    let kept = json(value(source, k))
    return kept === undefined ? [] : [[k, kept]]
  }))

/** Project authored documents, keeping additive declarations with their owner. */
export let anatomyDocuments = (documents: unknown): {
  comps: AnatomySeed<AnatomyComp>[]
  tools: AnatomySeed<AnatomyTool>[]
  effects: AnatomySeed<AnatomyEffect>[]
  rules: AnatomySeed<AnatomyRule>[]
} => {
  let comps: AnatomySeed<AnatomyComp>[] = []
  let tools: AnatomySeed<AnatomyTool>[] = []
  let effects: AnatomySeed<AnatomyEffect>[] = []
  let rules: AnatomySeed<AnatomyRule>[] = []
  array(documents).forEach((doc, ordinal) => {
    let owner = text(doc, 'package')
    let docKey = `${text(doc, '$id') ?? text(doc, 'title') ?? ''}:${ordinal}`
    for (let [name, def] of entries(value(doc, '$defs'))) {
      let description = text(def, 'description')
      let part = {
        name,
        package: owner,
        facet: 'vocab',
        declared: true,
        loaded: true,
        ...description === undefined ? {} : { description },
      }
      if (value(def, 'component') === true) {
        let props = entries(value(def, 'properties')).map(([name, schema]) => {
          let ref = text(schema, 'ref')
          return { name, schema: anatomyData(schema), refs: ref ? [ref] : [] }
        })
        comps.push({
          ...part,
          key: docKey,
          schema: anatomyData(def),
          props,
          extends: value(def, 'extends') === true,
          before: strings(value(def, 'before')),
          refs: [...new Set(props.flatMap((p) => p.refs))],
          rules: picked(def, [
            'wire',
            'computed',
            'embed',
            'kind',
            'mark',
            'sync',
            'durable',
            'pace',
            'search',
            'status',
            'required',
            'identity',
            'unique',
            'index',
          ]),
        })
      }
      if (value(def, 'tool') === true) {
        let inputSchema: Record<string, unknown> = {
          type: 'object',
          additionalProperties: false,
          properties: anatomyData(value(def, 'input')),
        }
        let required = strings(value(def, 'required'))
        if (required.length) inputSchema.required = required
        let outputSchema = value(def, 'outputSchema')
        tools.push({
          ...part,
          loaded: false,
          inputSchema,
          ...outputSchema ? { outputSchema: anatomyData(outputSchema) } : {},
          hints: picked(def, [
            'title',
            'options',
            'readOnly',
            'destructive',
            'idempotent',
            'openWorld',
            'surfaces',
            'roles',
          ]),
        })
      }
      if (value(def, 'effect') === true) {
        effects.push({
          ...part,
          loaded: false,
          noop: false,
          triggers: picked(def, [
            'created',
            'changed',
            'removed',
            'start',
            'active',
            'match',
            'sweep',
            'tries',
            'idempotent',
          ]),
        })
      }
      if (value(def, 'rule') === true) {
        rules.push({
          ...part,
          kind: 'data',
          hooks: [],
          phase: 'rules',
          ...picked(def, ['match', 'before', 'optimistic']),
        })
      }
    }
  })
  return { comps, tools, effects, rules }
}

/** Read registrations, never execute hooks, resources, rules or tool code. */
export let anatomyPlugin = (owner: string, plugin: unknown, ordinal = ''): {
  rules: AnatomySeed<AnatomyRule>[]
  hooks: AnatomySeed[]
} => {
  let name = text(plugin, 'name') ?? 'plugin'
  let phases = entries(value(plugin, 'hooks')).filter(([, h]) =>
    typeof h == 'function'
  )
    .map(([phase]) => phase)
  let capabilities = ['track', 'beforeWrite', 'wants', 'derive', 'address']
    .filter((k) => typeof value(plugin, k) == 'function')
  let rules: AnatomySeed<AnatomyRule>[] = [{
    name,
    package: owner,
    facet: 'rules',
    key: ordinal,
    kind: 'plugin',
    hooks: phases,
    requests: strings(value(plugin, 'requests')),
    resources: entries(value(plugin, 'resources')).map(([k]) => k),
    capabilities,
    declared: true,
    loaded: true,
    bound: true,
  }]
  let hooks: AnatomySeed[] = phases.map((phase) => ({
    name: `${name}:${phase}`,
    package: owner,
    facet: 'rules',
    key: ordinal,
    declared: true,
    loaded: true,
    bound: true,
  }))
  array(value(plugin, 'rules')).forEach((r, i) => {
    let match = text(r, 'match')
    rules.push({
      name: text(r, 'name') ?? `${name}:rule:${i}`,
      package: owner,
      facet: 'rules',
      key: `${ordinal}:code:${i}`,
      kind: 'code',
      hooks: [],
      phase: text(r, 'phase'),
      ...match === undefined ? {} : { match },
      declared: true,
      loaded: true,
      bound: true,
    })
  })
  array(value(plugin, 'declared')).forEach((d, i) => {
    // Declared entries wrap a rule plus its compiled pattern. The pattern and
    // any literal Patch on a code rule are deliberately outside the boundary.
    let r = value(d, 'rule') ?? d
    rules.push({
      name: text(r, 'name') ?? `${name}:declared:${i}`,
      package: owner,
      facet: 'rules',
      key: `${ordinal}:data:${i}`,
      kind: 'data',
      hooks: [],
      phase: 'rules',
      ...picked(r, ['match', 'before', 'optimistic']),
      declared: true,
      loaded: true,
      bound: true,
    })
  })
  return { rules, hooks }
}
