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
