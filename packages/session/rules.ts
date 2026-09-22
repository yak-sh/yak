// What a batch means about a transcript: the graph plugins exported as
// `@yaks/session/rules` — entry sequencing, the reference checks a fork and a
// `using` must pass, the lease on any entity, and the conflict row written when
// two sessions want the same thing.

import type { Plugin } from '@yaks/graph'
import { sessions } from './plugin.ts'

/** Transcripts, leases and the audit of a bounced claim. */
export let rules = (): Plugin[] => [sessions()]
