// The component declarations and their price/usage helpers: the module a
// server or browser page imports at `@yaks/model/vocab`. It reaches no storage,
// no SQL and no provider runtime.
//
// What a reply carries is declared elsewhere: `tool` belongs to @yaks/tools and
// `artifact` to @yaks/blob. An application that wants them composes those
// packages in — that is what a plugin list is for. Declaring them here as well
// would declare one component in two places, which `loadVocab` rejects.

import type { VocabDoc } from '@yaks/vocab'
import type { Paid } from './attribute.ts'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The `provider` and `model` components, to load beside your own. */
export let modelDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [modelDoc]

export let PROVIDER = 'provider'
export let MODEL = 'model'
export let USAGE = 'usage'
export let PRICE = 'price'
export let COST = 'cost'
export let RATE_LIMIT = 'rate_limit'

/** Counts for one request. Cached input and reasoning output are subsets,
 * not additional tokens. Missing counts are unknown. */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cached_tokens?: number
  cache_write_tokens?: number
  cache_write_1h_tokens?: number
  reasoning_tokens?: number
}

/** What a model costs, in dollars per million tokens: the `price` component
 * on its row. `cached` is the price of an input token the provider read from
 * its cache, where it has one; `cache_write` of one it wrote there, and
 * `cache_write_1h` of one written to be kept an hour. */
export type Price = {
  input: number
  output: number
  cached?: number
  cache_write?: number
  cache_write_1h?: number
}

/**
 * What a request cost, in dollars, weighed at its model's price: its cached
 * input at the cached price, what it wrote to the cache at the write price
 * (an hour's writes at theirs), the rest of its input and all of its output at
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
 *
 * let opus = { input: 4, cached: 0.2, cache_write: 5, cache_write_1h: 8, output: 20 }
 * assertAlmostEquals(weigh(opus, {
 *   input_tokens: 3_000_000,
 *   cached_tokens: 1_000_000,
 *   cache_write_tokens: 2_000_000,
 *   cache_write_1h_tokens: 1_000_000,
 * }), 0.2 + 5 + 8)
 * ```
 */
export let weigh = (price: Price, n: Usage): number => {
  let input = n.input_tokens ?? 0
  let cached = Math.min(n.cached_tokens ?? 0, input)
  let written = Math.min(n.cache_write_tokens ?? 0, input - cached)
  return dollars(
    price,
    [cached, written, input - cached - written, n.output_tokens ?? 0],
    hourly(n),
  )
}

/** The share of a request's cache writes kept an hour, 0 to 1. */
export let hourly = (n: Usage): number =>
  n.cache_write_tokens
    ? Math.min(1, (n.cache_write_1h_tokens ?? 0) / n.cache_write_tokens)
    : 0

/**
 * What tokens cost at a price, paid as `Paid` says (read from the cache,
 * written to it, fresh, generated), with `hour` of the writes kept an hour.
 *
 * ```ts
 * import { dollars } from '@yaks/model'
 * import { assertAlmostEquals } from '@std/assert'
 *
 * let opus = { input: 4, cached: 0.2, cache_write: 5, cache_write_1h: 8, output: 20 }
 * assertAlmostEquals(dollars(opus, [1e6, 1e6, 1e6, 1e6], 0.5), 0.2 + 6.5 + 4 + 20)
 * ```
 */
export let dollars = (
  price: Price,
  [read, write, fresh, output]: Paid,
  hour = 0,
): number => {
  let w = price.cache_write ?? price.input
  return (read * (price.cached ?? price.input) +
    write * ((1 - hour) * w + hour * (price.cache_write_1h ?? w)) +
    fresh * price.input + output * price.output) / 1e6
}
