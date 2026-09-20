// OpenRouter's own words, and only the words: the `vocab` facet a host takes
// (`@yaks/openrouter/vocab`). It reaches no transport and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** What OpenRouter keeps about a reply, as the document `loadVocab` takes. */
export let openrouterDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [openrouterDoc]
