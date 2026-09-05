// WHO turns text into a vector, and how a stored vector says which text and
// which model it came from.
//
// An `Embedder` is injected — a local model, a hosted API, whatever an
// application already pays for — because this package has an opinion about
// storing and searching vectors and none at all about producing them. It names
// its MODEL beside the function: two vectors are only comparable inside one
// model's space, so the name rides every stored row, screens a search, and folds
// into the content hash that decides what needs re-embedding.
//
// {@link hashEmbedder} is the one embedder shipped here: no model, no network,
// the same answer every time. It is what the tests use and what a new
// application can develop against before choosing a model.

import { unit } from './vector.ts'

/**
 * Text in, vector out — plus the name of the space the vectors live in. A model
 * change is a `model` change: the stored hash covers it, so the sweep re-embeds
 * the corpus and a search never mixes two spaces.
 */
export type Embedder = {
  /** names the vector space; changing it invalidates every stored vector */
  model: string
  /** the vector for a piece of text; may be async (a hosted model) */
  embed: (text: string) => Float32Array | Promise<Float32Array>
}

/**
 * Names the exact embedding a stored row holds: FNV-1a over the model and the
 * text. It is what lets the sweep skip what has not changed without keeping a
 * second copy of the prose.
 */
export let hash = (model: string, text: string): string =>
  fnv(`${model}\n${text}`).toString(36)

// FNV-1a, 32 bits. Small, fast, and stable across runtimes — which is all
// either caller needs: naming a stored embedding, and choosing a bucket.
let fnv = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  }
  return h
}

// The words a text is made of, lowercased. Deliberately crude — letters and
// digits, nothing else — because the point is a stable, language-agnostic split,
// not a tokenizer.
let words = (text: string): string[] =>
  text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/**
 * A deterministic embedder with no model behind it: every word is hashed into
 * one of `dim` buckets and the counts are normalized. Instant, offline, and the
 * same answer on every machine, so tests and local development never reach the
 * network.
 *
 * What it captures is vocabulary overlap — two texts sharing words score high,
 * two texts sharing none score 0 — and nothing else. It has no sense of
 * meaning, so swap in an embedding model before promising anyone semantic
 * search; the rest of this package does not change when you do.
 */
export let hashEmbedder = (dim = 64): Embedder => ({
  model: `hash-${dim}`,
  embed: (text) => {
    let v = new Float32Array(dim)
    for (let w of words(text)) {
      let h = fnv(w)
      // The top bit picks a sign, so two different words landing in one bucket
      // cancel as often as they reinforce instead of always adding up.
      v[h % dim] += h & 0x80000000 ? -1 : 1
    }
    return unit(v)
  },
})
