// The persona words, and only the words: the `vocab` facet a host takes
// (`@yaks/persona/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { personaDoc } from './comp.ts'

export { personaDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [personaDoc]
