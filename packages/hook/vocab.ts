// The hook words, and only the words: the `vocab` facet a host takes
// (`@yaks/hook/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The hook vocabulary, as the document `loadVocab` takes. */
export let hookDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [hookDoc]
