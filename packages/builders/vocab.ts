// The builders component declarations alone, exported as
// `@yaks/builders/vocab`: `builder`, `build`, `built`, and its build tool.
// Nothing here touches storage, SQL or any runtime API, so a browser tab that
// only needs these components loads nothing else.
//
// A builder's query selects inputs, and each output cites what it used. A build
// writes @yaks/session's components, so a graph loading this document loads
// those beside it. `build.cost` and `built.current` are computed, and `derived`
// is their SQL.

import type { Derived } from '@yaks/sql'
import type { Vocab, VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import { buildCost } from './cost.ts'
import { builtCurrent } from './current.ts'
import manifest from './deno.json' with { type: 'json' }

export { buildCost, builtCurrent }

/** The properties builders computes rather than stores: `built.current`, and
 * `build.cost` where the vocabulary declares the `cost.dollars` it sums
 * (@yaks/model), which a store holding an app's own `cost` does not. */
export let derived = (vocab: Vocab): Derived => ({
  'built.current': builtCurrent,
  ...vocab.prop('cost', 'dollars') ? { 'build.cost': buildCost } : {},
})

/** The builders vocabulary, as the document `loadVocab` accepts. */
export let builderDoc: VocabDoc = doc as VocabDoc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [builderDoc]
