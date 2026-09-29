// `@yaks/journal/vocab` — the declarations, and only the declarations: the
// `history` tool implemented in ./tools.ts, and the two components the journal
// is read as, `_tx` and `_change`. Both are computed: the journal is the record
// of what was applied, never part of it, so no table holds them and nothing
// writes them, and `backed` names the journal's own rows as what they are read
// from (./backed.ts).

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

export { backed } from './backed.ts'

/** The declarations this plugin contributes. */
export let journalDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [journalDoc]
