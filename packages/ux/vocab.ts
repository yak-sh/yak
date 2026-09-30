// The components UX components keep and say, and nothing else: the module a
// page's own graph loads at `@yaks/ux/vocab`. It reaches no storage and no
// runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The ux vocabulary, in the form `loadVocab` accepts. */
export let uxDoc: VocabDoc = doc as VocabDoc

/** Every document this package declares. */
export let docs: VocabDoc[] = [uxDoc]
