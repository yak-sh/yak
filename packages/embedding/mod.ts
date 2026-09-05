/**
 * @yaks/embedding — semantic search for a yaks graph: meaning-nearest entities,
 * beside the literal matches full-text gives.
 *
 * This package embeds any text property a vocabulary marks, stores the vectors
 * beside the rows, and answers a `.near=<entity>` query by ranking the graph by
 * cosine similarity to that entity's vector. It is generic over the text
 * property, exactly as {@link https://jsr.io/@yaks/fts | @yaks/fts} is — a
 * title, a body, or an app's own prose can all have neighbours — and the two
 * compose: keyword recall from FTS, semantic recall from here.
 *
 * The embedder is pluggable (a local model, a hosted API); this package owns
 * the sweep that keeps vectors current, the `.near` ranking, and the
 * duplicate hint that falls out of it. A {@link Storage} adapter holds the
 * vectors.
 *
 * @module
 */

import type { Eid } from '@yaks/graph'

/** Turns text into a vector — a local model or a hosted API satisfies this. */
export type Embedder = {
  /** the vector for a piece of text */
  embed: (text: string) => Promise<number[]>
}

/** One semantic neighbour: the entity and its similarity (1 is identical). */
export type Near = { entity: Eid; similarity: number }

/**
 * The semantic seam: keep the vectors current, and rank the graph by nearness
 * to an entity or a free-text vector. The implementation lands with the
 * package; this is the shape it satisfies.
 */
export type Semantic = {
  /** embed and store vectors for anything that has changed */
  sweep: () => Promise<void>
  /** the entities nearest an anchor entity, most similar first */
  near: (anchor: Eid, limit?: number) => Promise<Near[]>
}
