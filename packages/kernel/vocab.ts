// The component declarations and nothing else, exported as
// `@yaks/kernel/vocab`. It imports no storage, no SQL and no runtime API, so a
// browser tab loading this vocabulary loads nothing else with it.

import { type Keywords, pick, type VocabDoc } from '@yaks/vocab/runtime'
import { kernelKeywords } from './keywords.ts'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

export { kernelKeywords }

/** The kernel vocabulary, as the document `loadVocab` takes. */
export let kernelDoc: VocabDoc = doc as VocabDoc

/** Just `entity{archetype}`, for a program that loads it without the rest of
 * the kernel's components. @yaks/provenance declares the stamps beside it,
 * `created` and `updated`. */
export let spineDoc: VocabDoc = pick(kernelDoc, ['entity'], 'spine')

/** The two marks anything at all can carry — `opened`, somebody looked at it,
 * and `archived`, somebody put it away — for a program that loads `spineDoc`
 * without the rest of the kernel's components and still wants listings to hide
 * what was put away. */
export let marksDoc: VocabDoc = pick(kernelDoc, ['opened', 'archived'], 'marks')

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [kernelDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [kernelKeywords]
