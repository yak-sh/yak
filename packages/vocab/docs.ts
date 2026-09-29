// The components @yaks/vocab declares, exported as `@yaks/vocab/vocab`: the
// facet a host composes (@yaks/cli `compose`) when its config lists this
// package, so its graph can hold a vocabulary as `_package`, `_comp`, `_prop`
// and `_before` entities (./bundles.ts). `_before` is an @yaks/edge relation
// and each row wears @yaks/doc's `doc`, so a config listing this lists those
// beside it.

import type { VocabDoc } from './types.ts'
import { metaDoc } from './meta.ts'

/** Every document this package declares: the meta vocabulary. */
export let docs: VocabDoc[] = [metaDoc]
