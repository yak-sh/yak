// The serving words, and only the words: the `vocab` facet a host takes
// (`@yaks/model/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.
//
// What a reply CARRIES is said elsewhere: a `tool` is @yaks/tools's word and an
// `artifact` is @yaks/blob's. A host that wants them composes those packages —
// that is what a plugin list is for. Saying them here as well would give one
// word two homes, and `loadVocab` refuses that.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `provider` and `model` components, to load beside your own. */
export let modelDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [modelDoc]
