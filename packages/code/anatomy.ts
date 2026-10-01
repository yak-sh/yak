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
}
export type AnatomyComp = AnatomyPart & {
  schema: Record<string, unknown>
  props: AnatomyProp[]
  extends: boolean
  refs: string[]
  before: string[]
  rules: Record<string, unknown>
}
export type AnatomyTool = AnatomyPart & {
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  tier?: string
}
export type AnatomyCommand = AnatomyPart & {
  schema?: Record<string, unknown>
  usage?: string
}
export type AnatomyEffect = AnatomyPart & {
  handler?: string
  noop: boolean
}
export type AnatomyRule = AnatomyPart & { hooks: string[] }
export type AnatomyRoute = AnatomyPart & { method: string; path: string }
export type AnatomySkill = AnatomyPart & { path?: string }
export type AnatomyEdge = { id: string; from: string; to: string; kind: string }

/** No graph rows, plugin options, handler functions or secret values. */
export type Anatomy = {
  version: 1
  host: string
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
