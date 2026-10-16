import { facetsOf, used } from '@yaks/host/config'
// The facets a process serves, and the roles one command needs. This data is
// shared by import preparation and composition; reading it opens nothing.
import type { Declared } from './words.ts'
import type { Role } from './host.ts'

export { ROLES } from '@yaks/host/roles'

/** The graph and the roles a tool requests. A graph with no effect pool runs
 * its effects where they are committed. */
export let rolesOf = (
  tool: Pick<Declared, 'roles'>,
  pooled: boolean,
): Role[] => [
  ...new Set(['graph', ...pooled ? [] : ['effects'], ...tool.roles ?? []]),
]

/** Duties depend on declarations, not a second vocabulary runtime. */
export let dutyRoles = (
  config: import('./config.ts').Config,
  pooled: boolean,
  mine: readonly Role[],
  has: (plugin: string, facet: string) => boolean,
): Role[] =>
  [
    ...pooled ? ['effects'] : [],
    ...(config.plugins ?? []).filter((p) =>
      facetsOf(p)?.includes('service') ?? true
    ).map(used).filter((p) => has(p, 'service')),
  ].filter((role) => !mine.includes(role))
