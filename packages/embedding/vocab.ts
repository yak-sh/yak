// The words, and only the words: the `vocab` facet a host takes
// (`@yaks/embedding/vocab`). This package declares no COMPONENT — a vector is
// not a word anybody writes: it is derived from text somebody else's
// vocabulary declares, it never rides the wire, and no patch mints one, which
// is why the table is raised in SQL by ./rules.ts.
//
// What it does declare is one TOOL: the check in ./tools.ts. A tool is a word
// a vocabulary says and a host lists, so the index's own invariant is asked
// for the same way every other package's is.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declaration this plugin contributes. */
export let embeddingDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [embeddingDoc]
