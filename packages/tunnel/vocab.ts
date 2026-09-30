// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/tunnel/vocab`. It reaches no network and no
// runtime, so loading the vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The tunnel vocabulary, in the form `loadVocab` accepts. */
export let tunnelDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [tunnelDoc]
