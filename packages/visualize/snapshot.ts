/** The same composition envelope is served to a page, command and tool. */
import type { Anatomy, AnatomyPart } from '@yaks/code/anatomy'

export let GROUPS = [
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
] as const
export type Group = typeof GROUPS[number]
export let DEFAULT_LIMIT = 1000
export let MAX_LIMIT = 5000
export type Selection = {
  total: number
  matched: number
  shown: number
  truncated: boolean
}
export type SelectOptions = {
  group?: string
  search?: string
  id?: string
  limit?: number
}
export type Snapshot = {
  version: 1
  anatomy: Anatomy
  coverage: {
    scope: string
    activity: 'process-local'
    observed: Record<string, boolean>
    recording: 'subscriber-only'
    clock: 'monotonic'
    capacity: 256
  }
  takenAt: string
  selection?: Selection
}
export type Supplier = { anatomy?: () => Anatomy }

/** A missing supplier means unobserved, never an empty configured platform. */
let unobserved = (): Anatomy => ({
  version: 1,
  host: 'unobserved',
  packages: [],
  roles: [],
  facets: [],
  comps: [],
  tools: [],
  commands: [],
  effects: [],
  rules: [],
  hooks: [],
  routes: [],
  views: [],
  inspectViews: [],
  tui: [],
  kits: [],
  themes: [],
  skills: [],
  secrets: [],
  edges: [],
})

export let bounded = (n: number | undefined, fallback: number, max: number) =>
  Math.min(max, Math.max(1, Math.floor(Number.isFinite(n) ? n! : fallback)))

export let snapshot = (host: Supplier): Snapshot => {
  let anatomy = host.anatomy?.() ?? unobserved()
  let meta = anatomy as Anatomy & {
    scope?: string
    observed?: Record<string, boolean>
  }
  // Older suppliers prove only the native categories they actually compose.
  let native = [
    'packages',
    'roles',
    'facets',
    'comps',
    'tools',
    'effects',
    'rules',
    'hooks',
    'routes',
    'secrets',
  ]
  let observed = Object.fromEntries(GROUPS.map((group) => [
    group,
    meta.observed?.[group] ??
      (anatomy.host == 'native' && native.includes(group)),
  ]))
  return {
    version: 1,
    anatomy,
    coverage: {
      scope: meta.scope ?? anatomy.host,
      activity: 'process-local',
      observed,
      recording: 'subscriber-only',
      clock: 'monotonic',
      capacity: 256,
    },
    takenAt: new Date().toISOString(),
  }
}

/** Selects declared parts, not edges. Relation endpoints always remain valid. */
export let select = (source: Snapshot, opts: SelectOptions = {}): Snapshot => {
  let limit = bounded(opts.limit, DEFAULT_LIMIT, MAX_LIMIT)
  let text = opts.search?.trim().toLowerCase() ?? ''
  let ids = new Set<string>()
  let total = 0
  let matched = 0
  let shown = 0
  let anatomy = { ...source.anatomy }
  for (let group of GROUPS) {
    let parts: AnatomyPart[] = source.anatomy[group]
    total += parts.length
    let chosen = parts.filter((part) =>
      (!opts.group || opts.group == group) &&
      (!opts.id || opts.id == part.id) &&
      (!text || [part.name, part.package, part.facet, part.description]
        .some((s) => s?.toLowerCase().includes(text)))
    )
    matched += chosen.length
    let included = chosen.slice(0, Math.max(0, limit - shown))
    shown += included.length
    for (let part of included) ids.add(part.id) // Group membership is unchanged; TypeScript cannot express this union's
     // correlated array assignment without a structural view.
    ;(anatomy as unknown as Record<Group, AnatomyPart[]>)[group] = included
  }
  anatomy.edges = source.anatomy.edges.filter((edge) =>
    ids.has(edge.from) && ids.has(edge.to)
  )
  return {
    ...source,
    anatomy,
    selection: { total, matched, shown, truncated: shown < matched },
  }
}
