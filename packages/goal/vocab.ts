// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/goal/vocab`. It reaches no storage, no SQL
// and no runtime, so a browser tab loading this vocabulary loads nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The goal vocabulary, in the form `loadVocab` accepts. */
export let goalDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [goalDoc]
