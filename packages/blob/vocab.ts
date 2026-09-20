// The stored-value words, and only the words: the `vocab` facet a host takes
// (`@yaks/blob/vocab`). It reaches no storage and no runtime, so a browser tab
// loading this vocabulary loads nothing else.
//
// The `store` keyword is the whole of what this package says to a vocabulary:
// a text column marked with it keeps its value's hash, and the value lives
// wherever the composed store puts it. `derived` is the reading back — the SQL
// that joins the row's hash to the text — which is part of what the keyword
// MEANS rather than a rule about a batch.

import type { Keywords, Vocab, VocabDoc } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import { artifactDoc } from './artifact.ts'
import { blobKeywords } from './keywords.ts'
import { blobRead } from './sqlite.ts'

export { artifactDoc, blobKeywords, blobRead }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [artifactDoc]

/** The JSON Schema keywords those documents use. */
export let keywords: Keywords[] = [blobKeywords]

/** Every body column this vocabulary marks `store: blob`, read back as text. */
export let derived = (vocab: Vocab): Derived => blobRead(vocab)
