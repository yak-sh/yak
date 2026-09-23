// The schema declarations, and only those: the module a server imports from
// `@yaks/blob/vocab`. It reaches no storage and no runtime, so a browser tab
// loading this vocabulary loads nothing else.
//
// The `store` keyword is the whole of what this package contributes to a
// vocabulary: a text property marked with it keeps its value's hash, and the
// value itself lives wherever the configured store puts it. `derived` is the
// read back — the SQL that resolves the row's hash to the text — which is part
// of what the keyword means rather than a rule about how a write is applied.

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

/** Every body property this vocabulary marks `store: blob`, read back as
 * text. */
export let derived = (vocab: Vocab): Derived => blobRead(vocab)
