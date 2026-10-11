// The component declaration, and nothing else: the module a server or a browser
// page imports at `@yaks/openai/vocab`. It reaches no storage, no SQL and no
// runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The one comp this provider stamps on an ask it answered:
 * `openai{response_id}`. Load it beside the conversation's vocabulary. */
export let openaiDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [openaiDoc]
