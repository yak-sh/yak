// The page words, and only the words: the `vocab` facet a host takes
// (`@yaks/page/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { pageDoc } from './comp.ts'

export { pageDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [pageDoc]
