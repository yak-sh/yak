// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/model/vocab`. It reaches no storage, no SQL
// and no runtime, so a browser tab loading this vocabulary loads nothing else.
//
// What a reply carries is declared elsewhere: `tool` belongs to @yaks/tools and
// `artifact` to @yaks/blob. An application that wants them composes those
// packages in — that is what a plugin list is for. Declaring them here as well
// would declare one component in two places, which `loadVocab` rejects.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `provider` and `model` components, to load beside your own. */
export let modelDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [modelDoc]
