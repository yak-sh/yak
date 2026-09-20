// The words, and only the words: the `vocab` facet a host takes
// (`@yaks/journal/vocab`). This package declares no COMPONENT — the journal is
// the record OF the wire, never part of it, and appears in no snapshot. What
// it declares is one TOOL, the history in ./tools.ts, because a tool is a word
// a vocabulary says and a host lists: an entity's past is asked for the same
// way everything else here is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declaration this plugin contributes. */
export let journalDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [journalDoc]
