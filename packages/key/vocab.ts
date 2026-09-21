// The `key` component declaration and nothing else, exported as
// `@yaks/key/vocab`. It imports no storage, no SQL and no runtime API, so a
// browser tab loading this vocabulary loads nothing else with it.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { keyDoc } from './comp.ts'
import { keyKeywords } from './keywords.ts'

export { keyDoc, keyKeywords }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [keyDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [keyKeywords]
