// The `key` component declaration and nothing else, exported as
// `@yaks/key/vocab`. It imports no storage, no SQL and no runtime API, so a
// browser tab loading this vocabulary loads nothing else with it.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { keyDoc } from './comp.ts'
import { keyKeywords } from './keywords.ts'
import manifest from './deno.json' with { type: 'json' }

export { keyDoc, keyKeywords }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [keyDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [keyKeywords]
