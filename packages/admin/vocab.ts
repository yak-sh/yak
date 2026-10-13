// The declarations, and nothing else: the module a host imports at
// `@yaks/admin/vocab`. Its words are the `admin` verbs and the deploy
// catch-up's `rebuilt` mark (catchup.ts).

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The `admin` tools and the `rebuilt` mark. */
export let adminDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [adminDoc]
