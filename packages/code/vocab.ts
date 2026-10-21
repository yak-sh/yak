// The component declarations, and nothing else: the module a server or a
// browser page imports at `@yaks/code/vocab`. It reaches no storage and runs
// no subprocess.
//
// A module is identified by the `file{path, root}` it wears, which @yaks/file
// declares, rooted in a @yaks/git `repository`, so a graph loading this
// document loads @yaks/file's and @yaks/git's beside it, and @yaks/edge's for
// the `imports` relation.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** `package`, `module`, `symbol`, the `imports` relation and `code sync`. */
export let codeDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [codeDoc]
