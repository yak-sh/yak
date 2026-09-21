// The component declaration, and nothing else: the module a server or a
// browser page imports at `@yaks/openrouter/vocab`. It makes no HTTP requests
// and reaches no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** What this adapter records about a reply, in the form `loadVocab` accepts. */
export let openrouterDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [openrouterDoc]
