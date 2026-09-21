// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/context/vocab`. It reaches no storage, no SQL
// and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `prompt` entry's vocabulary, in the form `loadVocab` accepts. */
export let contextDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [contextDoc]
