// The inspector's own components, and nothing else: the module a page's own
// graph loads at `@yaks/inspect/vocab`. It reaches no storage and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The inspector's vocabulary, in the form `loadVocab` accepts. */
export let inspectDoc: VocabDoc = doc as VocabDoc

/** Every document this package declares. */
export let docs: VocabDoc[] = [inspectDoc]
