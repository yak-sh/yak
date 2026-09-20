// The instruction words, and only the words: the `vocab` facet a host takes
// (`@yaks/context/vocab`). It reaches no storage, no SQL and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `prompt` entry's vocabulary, as the document `loadVocab` takes. */
export let contextDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [contextDoc]
