// The facets selected by each common role; a plugin's service is its own role.
import type { Config } from './config.ts'
import { used } from './config.ts'
import type { Role } from './mod.ts'
export let ROLES = {
  graph: ['vocab', 'graph', 'tools'],
  web: ['routes', 'ui'],
  effects: ['effects'],
} as const
/** Common roles, followed by each configured plugin's service role. */
export let every = (config: Config): Role[] => [
  ...Object.keys(ROLES),
  ...(config.plugins ?? []).map(used),
]
export let common = (role: Role): role is keyof typeof ROLES =>
  Object.hasOwn(ROLES, role)
