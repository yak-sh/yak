// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/code/vocab`. It reaches no storage and runs
// no subprocess.
//
// A module is identified by the `file{path, repository}` it wears, which
// @yaks/git declares, so a graph loading this document loads @yaks/git's
// beside it, and @yaks/edge's for the `imports` relation.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** `package`, `module`, `symbol`, the `imports` relation and `code sync`. */
export let codeDoc: VocabDoc = doc

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [codeDoc]
