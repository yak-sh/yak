// The alias words, and only the words: the `vocab` facet a host takes
// (`@yaks/alias/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { aliasDoc } from './comp.ts'

export { aliasDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [aliasDoc]
