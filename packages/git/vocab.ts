// The git words, and only the words: the `vocab` facet a host takes
// (`@yaks/git/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.
//
// The OBJECTS' words and the SOURCE's are one document here. A host keeping
// packed objects in a store of their own loads {@link gitDoc} there instead,
// and composes only {@link checkoutDoc} — what a checkout IS — in its graph.

import type { VocabDoc } from '@yaks/vocab'
import { gitDoc, refDoc } from './comp.ts'
import { checkoutDoc } from './checkout_vocab.ts'

export { checkoutDoc, gitDoc, refDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [gitDoc]
