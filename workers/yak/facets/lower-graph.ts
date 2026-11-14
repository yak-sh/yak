// Named references lowered to the eid the vocabulary stores (app-writes.ts
// `lowering`), after the lenses have named each component as it is now.
import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { lowering } from '../app-writes.ts'

export let plugins = (host: { vocab: Vocab }): Plugin[] => [
  lowering(() => host.vocab),
]
