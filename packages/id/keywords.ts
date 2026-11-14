// The registration a document names when it uses ids. The letter a series is
// numbered in is a kind's `prefix`, which @yaks/vocab reads with the rest of the
// kind, so there is no keyword here for a loader to copy.

import type { Keywords } from '@yaks/vocab'

/** The URI a vocab file declares under `$vocabulary` to use ids. */
export let ID_URI = 'https://yak.sh/vocab/id'

/** The id vocabulary, ready to register: `loadVocab(docs, [idKeywords])`.
 * It adds no keyword: `prefix` is the kind's (@yaks/vocab `Vocab.kind`). */
export let idKeywords: Keywords = { uri: ID_URI }
