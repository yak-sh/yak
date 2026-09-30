// The component declarations and nothing else, exported as `@yaks/git/vocab`.
// This module imports no storage, no SQL and no runtime, so a browser tab that
// loads the vocabulary loads nothing else with it.
//
// The Git object components and the source-code components are one document
// here. A server that keeps packed objects in a store of their own loads
// {@link gitDoc} in that store, and loads only {@link checkoutDoc} — what a
// checkout is — in its own graph.

import type { VocabDoc } from '@yaks/vocab'
import { gitDoc, refDoc } from './comp.ts'
import { checkoutDoc } from './checkout_vocab.ts'
import manifest from './deno.json' with { type: 'json' }

export { checkoutDoc, gitDoc, refDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every vocabulary document this plugin declares. */
export let docs: VocabDoc[] = [gitDoc]
