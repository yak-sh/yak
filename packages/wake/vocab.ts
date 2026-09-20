// The wake words, and only the words: the `vocab` facet a host takes
// (`@yaks/wake/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { wakeDoc } from './comp.ts'

export { wakeDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [wakeDoc]
