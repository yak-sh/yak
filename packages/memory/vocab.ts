// The memory words, and only the words: the `vocab` facet a host takes
// (`@yaks/memory/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { memoryDoc } from './comp.ts'

export { memoryDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [memoryDoc]
