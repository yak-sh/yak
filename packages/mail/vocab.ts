// The mail components, and only those: the `@yaks/mail/vocab` entry point. It
// imports no storage, no SQL and no runtime, so a browser tab that loads this
// vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import { mailDoc } from './comp.ts'
import manifest from './deno.json' with { type: 'json' }

export { mailDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [mailDoc]
