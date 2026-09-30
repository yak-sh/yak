// The process components and nothing else, exported as `@yaks/process/vocab`
// for a caller that only needs to know the shape of the data. It imports no
// storage, no SQL and no runtime code, so a browser tab loading this
// vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { processDoc } from './comp.ts'
import manifest from './deno.json' with { type: 'json' }

export { processDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every vocabulary document this plugin declares. */
export let docs: VocabDoc[] = [processDoc]
