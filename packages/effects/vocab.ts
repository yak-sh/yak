// The effects words, and only the words: the `vocab` facet a host takes
// (`@yaks/effects/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { effectDoc } from './durable.ts'

export { effectDoc }

/** Every document this plugin declares — the durable tier's ledger, which a
 * host loads only when it wants effects that survive a crash. */
export let docs: VocabDoc[] = [effectDoc]
