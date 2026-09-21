// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/archetype/vocab`. It reaches no storage, no
// SQL and no runtime, so a browser tab loading this vocabulary loads nothing
// else.

import type { VocabDoc } from '@yaks/vocab'
import { archetypeDoc } from './sets.ts'

export { archetypeDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [archetypeDoc]
