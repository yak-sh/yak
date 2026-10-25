// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/egress/vocab`. It reaches no storage, no
// vault and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** `calls{month, count}` on a `uses` link, and the `called{month}` event that
 * adds one, in the form `loadVocab` accepts. */
export let egressDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [egressDoc]
