// The project words, and only the words: the `vocab` facet a host takes
// (`@yaks/project/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { projectDoc } from './comp.ts'

export { projectDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [projectDoc]
