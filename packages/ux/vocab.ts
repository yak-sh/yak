// The components UX components keep and say, and nothing else: the module a
// page's own graph loads at `@yaks/ux/vocab`. It reaches no storage and no
// runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The ux vocabulary, in the form `loadVocab` accepts. */
export let uxDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [uxDoc]
