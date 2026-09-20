// The process words, and only the words: the `vocab` facet a host takes
// (`@yaks/process/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { processDoc } from './comp.ts'

export { processDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [processDoc]
