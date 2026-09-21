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

export { checkoutDoc, gitDoc, refDoc }

/** Every vocabulary document this plugin declares. */
export let docs: VocabDoc[] = [gitDoc]
