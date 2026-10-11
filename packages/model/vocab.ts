// The component declarations and their price/usage helpers: the module a
// server or browser page imports at `@yaks/model/vocab`. It reaches no storage,
// no SQL and no provider runtime.
//
// What a reply carries is declared elsewhere: `tool` belongs to @yaks/tools and
// `artifact` to @yaks/blob. An application that wants them composes those
// packages in — that is what a plugin list is for. Declaring them here as well
// would declare one component in two places, which `loadVocab` rejects.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The `provider` and `model` components, to load beside your own. */
export let modelDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [modelDoc]

export let USAGE = 'usage'
export let PRICE = 'price'
export let COST = 'cost'

/** Counts for one request. Cached input and reasoning output are subsets,
 * not additional tokens. Missing counts are unknown. */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cached_tokens?: number
  reasoning_tokens?: number
}

/** What a model costs, in dollars per million tokens: the `price` component
 * on its row. `cached` is the price of an input token the provider read from
 * its cache, where it has one. */
export type Price = { input: number; output: number; cached?: number }

/**
 * What a request cost, in dollars, weighed at its model's price: its cached
 * input at the cached price, the rest of its input and all of its output at
 * theirs.
 *
 * ```ts
 * import { assertAlmostEquals } from '@std/assert'
 * import { weigh } from '@yaks/model'
 *
 * let flash = { input: 0.15, cached: 0.03, output: 0.5 }
 * let cost = weigh(flash, {
 *   input_tokens: 2_000_000,
 *   cached_tokens: 1_000_000,
 *   output_tokens: 1_000_000,
 * })
 * assertAlmostEquals(cost, 0.15 + 0.03 + 0.5)
 * ```
 */
export let weigh = (price: Price, n: Usage): number => {
  let cached = Math.min(n.cached_tokens ?? 0, n.input_tokens ?? 0)
  let fresh = (n.input_tokens ?? 0) - cached
  return (fresh * price.input + cached * (price.cached ?? price.input) +
    (n.output_tokens ?? 0) * price.output) / 1e6
}
