// The base words, and only the words: the `vocab` facet a host takes
// (`@yaks/kernel/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { kernelKeywords } from './keywords.ts'
import doc from './vocab.json' with { type: 'json' }

export { kernelKeywords }

/** The kernel vocabulary, as the document `loadVocab` takes. */
export let kernelDoc: VocabDoc = doc as VocabDoc

/** Just the spine and the two stamps every graph wants, for a host that takes
 * the base words without the rest of the kernel's: `entity{num, archetype}`,
 * `created{at, by, via}` and `updated{at, by, via}`. */
export let spineDoc: VocabDoc = {
  title: 'spine',
  $defs: Object.fromEntries(
    ['entity', 'created', 'updated'].map((
      n,
    ) => [n, (doc.$defs as Record<string, unknown>)[n]]),
  ),
} as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [kernelDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [kernelKeywords]
