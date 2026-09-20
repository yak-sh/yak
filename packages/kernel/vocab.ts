// The base words, and only the words: the `vocab` facet a host takes
// (`@yaks/kernel/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { kernelKeywords } from './keywords.ts'
import doc from './vocab.json' with { type: 'json' }

export { kernelKeywords }

/** The kernel vocabulary, as the document `loadVocab` takes. */
export let kernelDoc: VocabDoc = doc as VocabDoc

// A few of these words, under a title of their own — one home, read two ways.
let some = (title: string, names: string[]): VocabDoc =>
  ({
    title,
    $defs: Object.fromEntries(
      names.map((n) => [n, (doc.$defs as Record<string, unknown>)[n]]),
    ),
  }) as VocabDoc

/** Just the spine and the two stamps every graph wants, for a host that takes
 * the base words without the rest of the kernel's: `entity{num, archetype}`,
 * `created{at, by, via}` and `updated{at, by, via}`. */
export let spineDoc: VocabDoc = some('spine', ['entity', 'created', 'updated'])

/** The two marks anything at all can wear — `opened`, somebody looked at it,
 * and `archived`, somebody put it away — for a host that takes the spine
 * without the rest of the kernel's words and still keeps listings. */
export let marksDoc: VocabDoc = some('marks', ['opened', 'archived'])

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [kernelDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [kernelKeywords]
