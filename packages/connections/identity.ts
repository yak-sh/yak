// The integration an address names, without loading the seed installer or
// connection actions. Views and graph consumers resolve the same stored id.
import type { Eid } from '@yaks/graph/bundle'
import { identityEid } from '@yaks/graph/identity'

export let INTEGRATION = 'integration'

/** An integration's entity: one name identifies one integration. */
export let integrationEid = (name: string): Eid =>
  identityEid(INTEGRATION, [name])
