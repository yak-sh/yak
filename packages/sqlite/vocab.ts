// The words, and only the words: the `vocab` facet a host takes
// (`@yaks/sqlite/vocab`). This package declares no COMPONENT — a store is not
// a domain, and nothing here rides the wire. What it declares is two TOOLS,
// the checks in ./tools.ts, because a tool is a word a vocabulary says and a
// host lists: the file's own invariants are asked for the same way every other
// package's are.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declarations this plugin contributes. */
export let sqliteDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [sqliteDoc]
