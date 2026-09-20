// The mcp words, and only the words: the `vocab` facet a host takes
// (`@yaks/mcp/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { mcpDoc } from './graph.ts'

export { mcpDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [mcpDoc]
