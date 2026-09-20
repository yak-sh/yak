// The tool words, and only the words: the `vocab` facet a host takes
// (`@yaks/tools/vocab`). No executor dependencies — a browser tab loading this
// vocabulary loads nothing else.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
const { tool, ...calls } = doc.$defs
/** Invocation records; compose with toolDoc or an existing tool declaration. */
export const callDoc: VocabDoc = { $defs: calls }
export const toolDoc: VocabDoc = { $defs: { tool } }
export const toolsDoc: VocabDoc = doc

/** Every document this plugin declares. */
export const docs: VocabDoc[] = [toolsDoc]
