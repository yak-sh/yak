// The names a graph consumer reads: the integration an address names, and the
// components a connection, an app's use of one and a task's ask for one are, without loading the
// seed installer or connection actions. Views and graph consumers resolve the
// same stored id.
import type { Eid } from '@yaks/graph/bundle'
import { identityEid } from '@yaks/graph/identity'

export let INTEGRATION = 'integration'
export let CONNECTION = 'connection'
export let USES = 'uses'
export let ASKS = 'asks'

/** An integration's entity: one name identifies one integration. */
export let integrationEid = (name: string): Eid =>
  identityEid(INTEGRATION, [name])
