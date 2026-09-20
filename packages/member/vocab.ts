// The member words, and only the words: the `vocab` facet a host takes
// (`@yaks/member/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { memberDoc } from './comp.ts'

export { memberDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [memberDoc]
