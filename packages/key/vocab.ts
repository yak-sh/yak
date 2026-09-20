// The key words, and only the words: the `vocab` facet a host takes
// (`@yaks/key/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { keyDoc } from './comp.ts'
import { keyKeywords } from './keywords.ts'

export { keyDoc, keyKeywords }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [keyDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [keyKeywords]
