// The inspector's own components, and nothing else: the module a page's own
// graph loads at `@yaks/inspect/front`. They are the page's, never the graph's
// it inspects, so this is not a `./vocab` facet a host composes. It reaches no
// storage and no runtime.

import type { VocabDoc } from '@yaks/vocab'
import doc from './front.json' with { type: 'json' }

/** The inspector's vocabulary, in the form `loadVocab` accepts. */
export let inspectDoc: VocabDoc = doc as VocabDoc

/** Every document this package declares. */
export let docs: VocabDoc[] = [inspectDoc]
