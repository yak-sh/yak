// The component declarations, and nothing else: what a host or a page loads at
// `@yaks/rtc/vocab`. `rtc` is what a speaking entity wears, relayed to its
// listeners; `sfu` is the row a door keeps for each session it opened.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The `rtc` and `sfu` components. */
export let rtcDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [rtcDoc]
