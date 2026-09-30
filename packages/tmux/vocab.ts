// The component declaration, and nothing else: the module a server or a browser
// page imports at `@yaks/tmux/vocab`. It reaches no storage, no SQL and no
// runtime — and no tmux — so a browser tab loading this vocabulary loads
// nothing else.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The component recording that an entity is showing in a terminal. */
export let TMUX = 'tmux'

/** The tmux vocabulary, in the form `loadVocab` accepts. */
export let tmuxDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [tmuxDoc]
