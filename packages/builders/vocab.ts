// The builders component declarations alone, exported as
// `@yaks/builders/vocab`: `builder`, `built`, and the `builder build` tool.
// Nothing here touches storage, SQL or any runtime API, so a browser tab that
// only needs these components loads nothing else.
//
// A builder's inputs hang off @yaks/kernel's `reads` relation, and a build
// writes @yaks/session's components, so a graph loading this document loads
// those beside it.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The builders vocabulary, as the document `loadVocab` accepts. */
export let builderDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [builderDoc]
