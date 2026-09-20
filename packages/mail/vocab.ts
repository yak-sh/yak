// The mail words, and only the words: the `vocab` facet a host takes
// (`@yaks/mail/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { mailDoc } from './comp.ts'

export { mailDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [mailDoc]
