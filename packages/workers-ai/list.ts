// Workers AI's binding listing and published model page, never a code catalogue.
import type { Listed, Price } from '@yaks/model'

export type Listing = { name: string; task?: { name: string };
  properties?: { property_id: string; value: string }[] }

export let listed = (r: Listing): Listed => {
  let props = new Map(r.properties?.map((p) => [p.property_id, p.value]))
  let context = Number(props.get('context_window') ?? props.get('context_length'))
  return { name: r.name, label: r.name.split('/').at(-1),
    ...context > 0 ? { context } : {},
    ...r.task?.name ? { modalities: [
      /audio|speech|music/i.test(r.task.name) ? 'audio'
      : /image/i.test(r.task.name) ? 'image' : 'text',
    ] } : {},
  }
}

export let pagePrice = (body: string): Price | undefined => {
  let input = body.match(/\$([\d.]+) per (?:M|million) input tokens/i)
  let output = body.match(/\$([\d.]+) per (?:M|million) output tokens/i)
  let cache = body.match(/\$([\d.]+) per (?:M|million) cached input tokens/i)
  return input && output ? { input: Number(input[1]), output: Number(output[1]),
    ...cache ? { cached: Number(cache[1]) } : {} } : undefined
}

export let modelInfo = async (
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<Listed> => {
  let slug = name.split('/').at(-1)
  let res = await fetcher(
    `https://developers.cloudflare.com/workers-ai/models/${slug}/index.md`,
  )
  if (!res.ok) throw new Error(`Workers AI model page says ${res.status}`)
  let body = await res.text()
  let context = body.match(/Context Window[^\n]*?([\d,]+) tokens/i)
  let price = pagePrice(body)
  return { name, ...context ? { context: Number(context[1].replaceAll(',', '')) } : {},
    ...price ? { price } : {} }
}

export let listing = async (
  ai: { models?: (params?: { per_page?: number; page?: number }) => Promise<Listing[]> },
): Promise<Listed[]> => ai.models ? (await ai.models({ per_page: 1000 })).map(listed) : []
