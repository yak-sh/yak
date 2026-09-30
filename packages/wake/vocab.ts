// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/wake/vocab`. It reaches no storage, no SQL and
// no runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { wakeDoc } from './comp.ts'
import manifest from './deno.json' with { type: 'json' }

export { wakeDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [wakeDoc]
