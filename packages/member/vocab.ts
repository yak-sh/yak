// The component definitions and nothing else, exported as
// `@yaks/member/vocab`. It imports no storage, no SQL and no runtime code, so a
// browser tab that loads this vocabulary loads nothing else with it.

import type { VocabDoc } from '@yaks/vocab'
import { memberDoc } from './comp.ts'
import manifest from './deno.json' with { type: 'json' }

export { memberDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every vocabulary document this plugin contributes. */
export let docs: VocabDoc[] = [memberDoc]
