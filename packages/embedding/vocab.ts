// The vocabulary this package contributes, and nothing else
// (`@yaks/embedding/vocab`). It declares no COMPONENT — no client ever writes
// a vector: it is derived from text another package's vocabulary declares, it
// is never sent to a client, and no patch creates one, which is why the table
// is created in SQL by ./rules.ts.
//
// What it does declare is one TOOL: the check in ./tools.ts. A tool is
// declared in a vocabulary and listed by the server, so the index's own
// invariant can be asked about the same way every other package's is.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declaration this plugin contributes. */
export let embeddingDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [embeddingDoc]
