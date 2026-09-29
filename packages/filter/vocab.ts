// The component declaration, and nothing else: the module a page's own graph
// loads at `@yaks/filter/vocab`. It reaches no storage and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The filter vocabulary, in the form `loadVocab` accepts. */
export let filterDoc: VocabDoc = doc as VocabDoc

/** Every document this package declares. */
export let docs: VocabDoc[] = [filterDoc]
