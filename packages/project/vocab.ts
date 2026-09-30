// The portfolio's component declarations and nothing else, exported as
// `@yaks/project/vocab`. It imports no storage, no SQL and no runtime API, so a
// browser tab loading this vocabulary loads nothing else with it.

import type { VocabDoc } from '@yaks/vocab'
import { projectDoc } from './comp.ts'
import manifest from './deno.json' with { type: 'json' }

export { projectDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [projectDoc]
