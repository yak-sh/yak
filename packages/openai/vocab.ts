// The openai words, and only the words: the `vocab` facet a host takes
// (`@yaks/openai/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { openaiDoc } from './responses.ts'

export { openaiDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [openaiDoc]
