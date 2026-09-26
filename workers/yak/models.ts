// The models a space may spend its model allowance on, each with its price:
// the platform's catalogue (D-40545). A model with no row here has no price,
// so nothing asks it: a call is weighed in dollars by its row and counted on
// the space's meter (meter.ts `models`), and a call that could not be weighed
// could not be counted.
//
// Prices are Workers AI's own, in dollars per million tokens, from each
// model's page at developers.cloudflare.com/workers-ai/models. A row an app
// may ask is `offered`; the rest are the builder's alone (builder.ts).

/** What a model costs, in dollars per million tokens. `cached` is the price
 * of an input token the provider read from its cache, where it has one. */
export type Price = { input: number; output: number; cached?: number }

/** One model in the catalogue, by the name Workers AI runs it under. */
export type Row = Price & { name: string; label: string; offered: boolean }

export let CATALOGUE: Row[] = [
  {
    name: '@cf/zai-org/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    input: 0.15,
    cached: 0.03,
    output: 0.5,
    offered: true,
  },
  {
    name: 'typesafe/jev',
    label: 'Jev',
    input: 0.042,
    output: 0,
    offered: true,
  },
  {
    name: '@cf/baai/bge-base-en-v1.5',
    label: 'BGE base (embeddings)',
    input: 0.067,
    output: 0,
    offered: true,
  },
  {
    name: '@cf/zai-org/glm-5.3',
    label: 'GLM 5.3',
    input: 1.4,
    cached: 0.26,
    output: 4.4,
    offered: false,
  },
]

let rows = new Map(CATALOGUE.map((r) => [r.name, r]))

/** A model's row, or undefined for one the catalogue does not price. */
export let priceOf = (name: string): Row | undefined => rows.get(name)

/** The token counts a call is weighed by: @yaks/model's `Usage`, which is what
 * @yaks/workers-ai `usageOf` reads off an answer. */
export type Counts = {
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
}

/**
 * What a call cost, in dollars: its cached input at the cached price, the rest
 * of its input and all of its output at theirs.
 *
 * ```ts
 * import { assertAlmostEquals } from '@std/assert'
 * import { weigh } from './models.ts'
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
export let weigh = (price: Price, n: Counts) => {
  let cached = Math.min(n.cached_tokens ?? 0, n.input_tokens ?? 0)
  let fresh = (n.input_tokens ?? 0) - cached
  return (fresh * price.input + cached * (price.cached ?? price.input) +
    (n.output_tokens ?? 0) * price.output) / 1e6
}

/** A count a model left unsaid, estimated from what was sent or said: four
 * characters to a token, the usual rule for English. An embedding model
 * reports no usage at all, and its text is what it is billed on. */
export let guess = (sent: unknown) =>
  Math.ceil(JSON.stringify(sent ?? '').length / 4)
