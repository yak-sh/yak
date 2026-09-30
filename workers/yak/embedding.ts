// Which model a store's vectors are made by (@yaks/embedding, T-59101). Every
// store on the platform keeps a vector beside each text its vocabulary marks
// `search: true`, in its own SQLite, and answers `.near=<entity>` exactly
// from a copy of them held in the object's memory, loaded the first time a
// search asks, so a search reads no vector rows (@yaks/embedding held.ts;
// the measurements are on T-59374). A Durable Object cannot load
// sqlite-vector, and a space's stores are small enough to hold. The directory
// is a store like any other, so the memories a space keeps are ranked the
// same way (memory.ts).
//
// Workers AI makes the vectors, through the `AI` binding every store is given:
// Qwen3-Embedding, kept at 256 of its 1024 dimensions, which it was trained to
// be cut to. Where the binding is absent (a test, a probe), nothing is
// embedded and `.near` ranks over whatever is already stored.

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

/** The model and width every store's vectors are in. Changing either is a
 * new vector space, and each store's sweep re-embeds its text once. */
export let MODEL = '@cf/qwen/qwen3-embedding-0.6b'
export let DIM = 256

/** That space, as the name each stored vector carries. */
export let SPACE = space({ model: MODEL, dim: DIM })

/** The embedder a store runs over the binding it was handed, or none. */
export let embedder = (bind: { AI?: Ai }): Embedder | null =>
  bind.AI ? workersAi({ model: MODEL, dim: DIM, ai: bind.AI }) : null

/** The text a store embeds: every property its vocabulary marks searched,
 * read through its derived columns, so a body kept by address is its prose. */
export let texts = (vocab: Vocab, derived: Derived): Field[] =>
  resolved(fields(vocab, searched), derived)
