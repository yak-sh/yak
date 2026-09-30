// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/context/vocab`. It reaches no storage, no SQL
// and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The `prompt` entry's vocabulary, in the form `loadVocab` accepts. */
export let contextDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [contextDoc]
