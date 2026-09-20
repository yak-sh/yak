// What a batch MEANS about a transcript: the `rules` facet a host takes
// (`@yaks/session/rules`) — entry sequencing, the naming checks a fork and a
// `using` must pass, the lease on any entity, and the conflict written down
// when two sessions want one thing.

import type { Plugin } from '@yaks/graph'
import { sessions } from './plugin.ts'

/** Transcripts, leases and the audit of a bounced claim. */
export let rules = (): Plugin[] => [sessions()]
