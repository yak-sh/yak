// OpenRouter's own listing, in the provider-neutral model row shape.
import type { Listed } from '@yaks/model'

type Row = {
  id: string
  name?: string
  context_length?: number
  architecture?: { output_modalities?: string[] }
  pricing?: {
    prompt?: string
    completion?: string
    input_cache_read?: string
    input_cache_write?: string
  }
}

// Dollars per token as OpenRouter writes them, per million as a price says,
// without the float noise of the product (0.00000625 → 6.25).
let perMillion = (s: string) => Number((Number(s) * 1e6).toPrecision(12))

export let listed = (r: Row): Listed => ({
  name: r.id,
  ...r.name ? { label: r.name } : {},
  ...r.context_length ? { context: r.context_length } : {},
  ...r.architecture?.output_modalities
    ? {
      modalities: r.architecture.output_modalities.map((m) =>
        m == 'speech' ? 'audio' : m
      ),
    }
    : {},
  ...r.pricing?.prompt != null && r.pricing.completion != null
    ? {
      price: {
        input: perMillion(r.pricing.prompt),
        output: perMillion(r.pricing.completion),
        ...r.pricing.input_cache_read != null
          ? { cached: perMillion(r.pricing.input_cache_read) }
          : {},
        ...r.pricing.input_cache_write != null
          ? { cache_write: perMillion(r.pricing.input_cache_write) }
          : {},
      },
    }
    : {},
})

export let listing = async (
  fetcher: typeof fetch = fetch,
): Promise<Listed[]> => {
  let res = await fetcher('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`OpenRouter models says ${res.status}`)
  let body: { data: Row[] } = await res.json()
  return body.data.map(listed)
}

/** Speech is a provider endpoint capability, not a list kept in code. */
export let speechModels = async (
  fetcher: typeof fetch = fetch,
): Promise<string[]> => {
  let res = await fetcher(
    'https://openrouter.ai/api/v1/models?output_modalities=speech',
  )
  if (!res.ok) throw new Error(`OpenRouter models says ${res.status}`)
  let body: { data: Row[] } = await res.json()
  return body.data.map((r) => r.id)
}
