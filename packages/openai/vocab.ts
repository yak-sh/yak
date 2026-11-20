// The component declaration, and nothing else: the module a server or a browser
// page imports at `@yaks/openai/vocab`. It reaches no storage, no SQL and no
// runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }

/** The one comp this provider stamps on an ask it answered:
 * `openai{response_id}`. Load it beside the conversation's vocabulary. */
export let openaiDoc: VocabDoc = doc

/** The reply an ask's `openai{response_id}` (or `name`'s, for a provider
 * stamping its own) names, which a later request continues from where the
 * provider stored it. */
export let responseAnchor = (
  comps: Record<string, unknown>,
  name = 'openai',
): string | undefined => {
  let id = (comps[name] as Record<string, unknown> | undefined)?.response_id
  return typeof id == 'string' && id ? id : undefined
}

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [openaiDoc]
