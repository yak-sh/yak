/** Vocabulary for tools and recorded invocations; no executor dependencies. */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
const { tool, ...calls } = doc.$defs
/** Invocation records; compose with toolDoc or an existing tool declaration. */
export const callDoc: VocabDoc = { $defs: calls }
export const toolDoc: VocabDoc = { $defs: { tool } }
export const toolsDoc: VocabDoc = doc
