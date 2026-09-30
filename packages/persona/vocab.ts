// The persona component declarations alone, exported as
// `@yaks/persona/vocab`. Nothing here touches storage, SQL or any runtime API,
// so a browser tab that only needs these components loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { personaDoc } from './comp.ts'
import manifest from './deno.json' with { type: 'json' }

export { personaDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [personaDoc]
