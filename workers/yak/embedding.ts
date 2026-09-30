// Which model a store's vectors are made by (@yaks/embedding, T-59101). Every
// store on the platform keeps a vector beside each text its vocabulary marks
// `search: true`, in its own SQLite, and answers `.near=<entity>` from a copy
// of them held in the object's memory, loaded the first time a search asks,
// so a search reads only the rows of the few it ranks last (@yaks/embedding
// held.ts; the measurements are on T-59374 and T-61474). A Durable Object
// cannot load sqlite-vector, and a space's stores are small enough to hold.
// The directory is a store like any other, so the memories a space keeps are
// ranked the same way (memory.ts).
//
// Workers AI makes the vectors, through the `AI` binding every store is given:
// Qwen3-Embedding at its full 1024 dimensions (T-61474). The store keeps them
// as float32 in its SQLite and holds them as int8 in memory, 1 KB each; a
// search scans the int8 copy and ranks its best hundred by their float rows,
// which keeps ~99.8% of the full vectors' quality where a cut to 256 kept
// ~95%. Where the binding is absent (a test, a probe), nothing is embedded
// and `.near` ranks over whatever is already stored.

import {
  type Ai,
  type Embedder,
  type Field,
  fields,
  resolved,
  searched,
  space,
  workersAi,
} from '@yaks/embedding'
import type { Derived } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

/** The model every store's vectors are made by. Changing it, or cutting its
 * width, is a new vector space, and each store's sweep re-embeds its text
 * once, in slices behind its own traffic (graph.ts `#embedding`). */
export let MODEL = '@cf/qwen/qwen3-embedding-0.6b'

/** The width Workers AI answers it at, every coordinate kept. */
export let DIM = 1024

/** That space, as the name each stored vector carries. */
export let SPACE = space({ model: MODEL })

/** The embedder a store runs over the binding it was handed, or none. */
export let embedder = (bind: { AI?: Ai }): Embedder | null =>
  bind.AI ? workersAi({ model: MODEL, ai: bind.AI }) : null

/** The text a store embeds: every property its vocabulary marks searched,
 * read through its derived columns, so a body kept by address is its prose. */
export let texts = (vocab: Vocab, derived: Derived): Field[] =>
  resolved(fields(vocab, searched), derived)
