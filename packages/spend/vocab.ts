// The component and tool declarations, and nothing else: the module a server
// or a browser page imports at `@yaks/spend/vocab`. It reaches no storage and
// no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The spend vocabulary: `spend{day, requests, tokens, dollars, parts,
 * sessions, tasks, models, entries}` and the `spend_show` and
 * `spend_backfill` tools, in the form `loadVocab` accepts. */
export let spendDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description. */
export let description: string = manifest.description

/** Every document this package declares. */
export let docs: VocabDoc[] = [spendDoc]
