// The component declarations and nothing else, exported as
// `@yaks/kernel/vocab`. It imports no storage, no SQL and no runtime API, so a
// browser tab loading this vocabulary loads nothing else with it.

import { type Keywords, pick, type VocabDoc } from '@yaks/vocab'
import { kernelKeywords } from './keywords.ts'
import doc from './vocab.json' with { type: 'json' }

export { kernelKeywords }

/** The kernel vocabulary, as the document `loadVocab` takes. */
export let kernelDoc: VocabDoc = doc as VocabDoc

/** Just `entity{archetype}` and the two provenance marks every graph
 * wants, `created{at, by, via}` and `updated{at, by, via}` — for a program that
 * loads those without the rest of the kernel's components. */
export let spineDoc: VocabDoc = pick(kernelDoc, [
  'entity',
  'created',
  'updated',
], 'spine')

/** The two marks anything at all can carry — `opened`, somebody looked at it,
 * and `archived`, somebody put it away — for a program that loads `spineDoc`
 * without the rest of the kernel's components and still wants listings to hide
 * what was put away. */
export let marksDoc: VocabDoc = pick(kernelDoc, ['opened', 'archived'], 'marks')

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [kernelDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [kernelKeywords]
