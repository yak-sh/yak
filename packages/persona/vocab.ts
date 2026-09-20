// The persona words, and only the words: the `vocab` facet a host takes
// (`@yaks/persona/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The persona vocabulary, as the document `loadVocab` takes. */
export let personaDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [personaDoc]
