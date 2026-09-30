// The dreaming component declarations alone, exported as
// `@yaks/dreaming/vocab`. Nothing here touches storage, SQL or any runtime
// API, so a browser tab that only needs these components loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The dreaming vocabulary, as the document `loadVocab` accepts. */
export let dreamingDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [dreamingDoc]
