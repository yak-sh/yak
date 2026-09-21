// The component declarations and nothing else, exported as
// `@yaks/kernel/vocab`. It imports no storage, no SQL and no runtime API, so a
// browser tab loading this vocabulary loads nothing else with it.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { kernelKeywords } from './keywords.ts'
import doc from './vocab.json' with { type: 'json' }

export { kernelKeywords }

/** The kernel vocabulary, as the document `loadVocab` takes. */
export let kernelDoc: VocabDoc = doc as VocabDoc

// A few of these components under a title of their own: one declaration, read
// two ways.
let some = (title: string, names: string[]): VocabDoc =>
  ({
    title,
    $defs: Object.fromEntries(
      names.map((n) => [n, (doc.$defs as Record<string, unknown>)[n]]),
    ),
  }) as VocabDoc

/** Just `entity{num, archetype}` and the two provenance marks every graph
 * wants, `created{at, by, via}` and `updated{at, by, via}` — for a program that
 * loads those without the rest of the kernel's components. */
export let spineDoc: VocabDoc = some('spine', ['entity', 'created', 'updated'])

/** The two marks anything at all can carry — `opened`, somebody looked at it,
 * and `archived`, somebody put it away — for a program that loads `spineDoc`
 * without the rest of the kernel's components and still wants listings to hide
 * what was put away. */
export let marksDoc: VocabDoc = some('marks', ['opened', 'archived'])

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [kernelDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [kernelKeywords]
