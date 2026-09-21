// `@yaks/journal/vocab` — the declarations, and only the declarations. This
// package declares no COMPONENT: the journal is the record OF what was applied,
// never part of it, and appears in no snapshot. What it does declare is one
// TOOL, the `history` implemented in ./tools.ts, because a tool is a name a
// vocabulary declares and a server lists: an entity's past is asked for the
// same way everything else here is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declaration this plugin contributes. */
export let journalDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [journalDoc]
