// The component declaration, and nothing else: the module a server or a browser
// page imports at `@yaks/tmux/vocab`. It reaches no storage, no SQL and no
// runtime — and no tmux — so a browser tab loading this vocabulary loads
// nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component recording that an entity is showing in a terminal. */
export let TMUX = 'tmux'

/** The tmux vocabulary, in the form `loadVocab` accepts. */
export let tmuxDoc: VocabDoc = doc as VocabDoc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [tmuxDoc]
