// The component declarations and how to read them: the module a server or a
// browser page imports at `@yaks/edge/vocab`. It reaches no storage, no SQL and
// no runtime, so a browser tab loading this vocabulary loads nothing else.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { edgeDoc } from './comp.ts'
import { edgeKeywords } from './keywords.ts'

export { edgeDoc, edgeKeywords }
export { names, relations, reversed } from './relations.ts'

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [edgeDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [edgeKeywords]
