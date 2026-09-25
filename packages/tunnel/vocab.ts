// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/tunnel/vocab`. It reaches no network and no
// runtime, so loading the vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tunnel vocabulary, in the form `loadVocab` accepts. */
export let tunnelDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [tunnelDoc]
