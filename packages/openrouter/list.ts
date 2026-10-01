// OpenRouter's own listing, in the provider-neutral model row shape.
import type { Listed } from '@yaks/model'

type Row = {
  id: string
  name?: string
  context_length?: number
  architecture?: { output_modalities?: string[] }
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string }
}

export let listed = (r: Row): Listed => ({
  name: r.id,
  ...r.name ? { label: r.name } : {},
  ...r.context_length ? { context: r.context_length } : {},
  ...r.architecture?.output_modalities
    ? { modalities: r.architecture.output_modalities } : {},
  ...r.pricing?.prompt != null && r.pricing.completion != null ? {
    price: {
      input: Number(r.pricing.prompt) * 1e6,
      output: Number(r.pricing.completion) * 1e6,
      ...r.pricing.input_cache_read != null
        ? { cached: Number(r.pricing.input_cache_read) * 1e6 } : {},
    },
  } : {},
})

export let listing = async (fetcher: typeof fetch = fetch): Promise<Listed[]> => {
  let res = await fetcher('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`OpenRouter models says ${res.status}`)
  let body: { data: Row[] } = await res.json()
  return body.data.map(listed)
}
