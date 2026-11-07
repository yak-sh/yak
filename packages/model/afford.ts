// A caller supplies an upper bound on every input token the provider may bill,
// including retained history and provider framing. Estimates are not bounds.
import type { Request } from './mod.ts'
import { type Price, type Usage, weigh } from './vocab.ts'

export type Affordable = { tokens: number; dollars: number }

/** Tokens a provider may add around a prompt: role markers, a chat template's
 * own system text, tool framing. */
export let FRAMING = 1024

let media = new Set([
  'image',
  'document',
  'image_url',
  'input_image',
  'audio',
  'input_audio',
  'video',
])
let textual = (value: unknown): boolean =>
  value == null || typeof value != 'object' ||
  !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer) &&
    (Array.isArray(value) ? value.every(textual) : Object.entries(value).every(
      ([k, v]) =>
        !media.has(k) && !(k == 'kind' && media.has(String(v))) && textual(v),
    ))

let size = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? '').length

/** An upper bound on the input tokens a text prompt and the tools it declares
 * can bill, never above the model's context window. A text token covers at
 * least one UTF-8 byte, so the compact JSON bounds the text; doubling it
 * covers a template that re-renders that JSON with spaces and indentation,
 * and FRAMING the markers around it. Media is tokenized by its pixels or
 * samples, not its bytes, so a prompt carrying any is bounded by the context
 * window alone. Only the prompt is searched for media: a tool is declared as
 * text, whatever its arguments are named. */
export let promptBound = (
  prompt: unknown,
  context: number,
  tools?: unknown,
): number =>
  textual(prompt)
    ? Math.min(context, 2 * (size(prompt) + size(tools)) + FRAMING)
    : context

/** A request's input bound. An anchor continues a conversation the provider
 * holds, whose earlier turns this side cannot measure. */
export let requestBound = (
  req:
    & Pick<Request, 'anchor' | 'instructions' | 'tools' | 'questions' | 'input'>
    & { items: unknown[] },
  context: number,
): number =>
  req.anchor ? context : promptBound(
    [req.instructions, req.items, req.questions, req.input],
    context,
    req.tools,
  )

/** A request's price as it can be billed. A provider keeps the longest cache
 * lifetime it offers that is not over what the request asks
 * (`Request.cacheRetention`), or its default, so only a request asking an
 * hour can write to the hour's cache at its dearer tariff. */
export let retained = (price: Price, seconds = 0): Price =>
  seconds >= HOUR ? price : { ...price, cache_write_1h: undefined }
let HOUR = 3600

let valid = (n: number) => Number.isFinite(n) && n >= 0
let upward = (dollars: number) => Math.ceil(dollars * 1e12) / 1e12

/** The most output affordable after reserving every input token at its highest
 * possible tariff, and `searches` web searches at theirs. The returned dollars
 * cover that entire call; a provider must enforce the returned output token
 * limit before it spends anything. */
export let affordable = (
  price: Price,
  input: number,
  remaining: number,
  tokens = 4096,
  searches = 0,
): Affordable | null => {
  let rates = [
    price.input,
    price.cached ?? price.input,
    price.cache_write ?? price.input,
    price.cache_write_1h ?? price.cache_write ?? price.input,
  ]
  if (
    !rates.every(valid) || !valid(price.output) || !valid(input) ||
    !valid(remaining) || !valid(price.web_search ?? 0) ||
    !Number.isSafeInteger(searches) || searches < 0 ||
    !Number.isSafeInteger(input) || !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    tokens == 0 && price.output > 0
  ) return null
  let fixed = upward(
    input * Math.max(...rates) / 1e6 + searches * (price.web_search ?? 0),
  )
  if (fixed > remaining) return null
  let output = price.output
    ? Math.min(tokens, Math.floor((remaining - fixed) * 1e6 / price.output))
    : tokens
  let dollars = upward(fixed + output * price.output / 1e6)
  // Floating point division can round the quotient up by one output token.
  if (dollars > remaining && output > 0) {
    output--
    dollars = upward(fixed + output * price.output / 1e6)
  }
  return dollars <= remaining && (output > 0 || tokens == 0)
    ? { tokens: output, dollars }
    : null
}

/** Settlement uses reported dollars or complete usage. Unknown usage keeps the
 * maximum reserved; unclassified input is charged at its highest cache tariff. */
export let charged = (
  reply: { cost?: number; costReported?: boolean; usage?: Usage },
  price: Price | undefined,
  maximum: number,
): { dollars: number; reported: boolean } => {
  if (reply.cost != null) {
    return { dollars: reply.cost, reported: reply.costReported ?? true }
  }
  let n = reply.usage
  if (
    !price || n?.input_tokens == null ||
    price.output > 0 && n.output_tokens == null ||
    !Object.values(n ?? {}).every((count) =>
      count == null || Number.isSafeInteger(count) && count >= 0
    )
  ) {
    return { dollars: maximum, reported: false }
  }
  let input = Math.max(
    price.input,
    price.cached ?? price.input,
    price.cache_write ?? price.input,
    price.cache_write_1h ?? price.cache_write ?? price.input,
  )
  return { dollars: weigh({ ...price, input }, n), reported: false }
}
