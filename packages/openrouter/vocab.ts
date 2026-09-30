// The component declaration, and nothing else: the module a server or a
// browser page imports at `@yaks/openrouter/vocab`. It makes no HTTP requests
// and reaches no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** What this adapter records about a reply, in the form `loadVocab` accepts. */
export let openrouterDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [openrouterDoc]
