// The one property this package stores, exported as `@yaks/id/vocab`. It
// imports no storage, no SQL and no runtime API, so a browser tab can load it
// alone.
//
// `num` is added to `entity` rather than declared as a component of its own:
// the number sits in the identity row beside the eid, which is the one row
// every storage adapter already has. A graph that loads this document has
// numbers; one that does not has none, and nothing else about it changes.

import type { Keywords, VocabDoc } from '@yaks/vocab'
import { idKeywords } from './keywords.ts'
import doc from './vocab.json' with { type: 'json' }

export { idKeywords }

/** `entity{num}`: the number a human id is built from. */
export let idDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [idDoc]

/** The JSON Schema keywords those documents use — and the `prefix` keyword the
 * components in other documents declare, which is what gives each series its
 * letter. */
export let keywords: Keywords[] = [idKeywords]
