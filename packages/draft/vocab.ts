// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/draft/vocab`. It reaches no storage and no
// runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The draft vocabulary: `draft{by, place, text, rev}` and the `typed{over}`
 * event, in the form `loadVocab` accepts. */
export let draftDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [draftDoc]
