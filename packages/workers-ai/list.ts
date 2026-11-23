// Workers AI's binding listing and published model page, never a code catalogue.
import type { Listed, Price } from '@yaks/model'
import { type Clock, type Hold, sharing, system } from '@yaks/fp'
import { pageReads } from './reads.ts'

export type Listing = {
  name: string
  task?: { name: string }
  properties?: { property_id: string; value: string }[]
}

let speaks = (kind: string) => /text[- ]to[- ]speech/i.test(kind)

export let listed = (r: Listing): Listed => {
  let props = new Map(r.properties?.map((p) => [p.property_id, p.value]))
  let context = Number(
    props.get('context_window') ?? props.get('context_length'),
  )
  return {
    name: r.name,
    label: r.name.split('/').at(-1),
    ...context > 0 ? { context } : {},
    ...r.task?.name
      ? {
        modalities: [
          /audio|speech|music/i.test(r.task.name)
            ? 'audio'
            : /image/i.test(r.task.name)
            ? 'image'
            : 'text',
        ],
      }
      : {},
  }
}

export let pagePrice = (body: string): Price | undefined => {
  let input = body.match(/\$([\d.]+) per (?:M|million) input tokens/i)
  let output = body.match(/\$([\d.]+) per (?:M|million) output tokens/i)
  let cache = body.match(/\$([\d.]+) per (?:M|million) cached input tokens/i)
  return input && (output || /Text Embeddings/i.test(body))
    ? {
      input: Number(input[1]),
      output: output ? Number(output[1]) : 0,
      ...cache ? { cached: Number(cache[1]) } : {},
    }
    : undefined
}

/** The rate of a native speech call, in dollars per thousand input characters. */
export type Published = Listed & { speechPerThousand?: number }

let speechPrice = (body: string): number | undefined => {
  if (!/^Text[- ]to[- ]Speech\s*•/im.test(body)) return
  let rate = Number(
    body.match(
      /Unit Pricing\s*\|\s*\$(\d+(?:\.\d+)?) per 1k (?:input )?characters\b/i,
    )?.[1],
  )
  if (Number.isFinite(rate)) return rate
}

type Info = { model: Published; reads: Record<string, number> }

let readInfo = async (
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<Info> => {
  let slug = name.split('/').at(-1)
  let res = await fetcher(
    `https://developers.cloudflare.com/workers-ai/models/${slug}/index.md`,
  )
  if (res.status == 404) {
    let path = name.replace(/^@cf\//, '').split('/').map(encodeURIComponent)
      .join('/')
    res = await fetcher(
      `https://developers.cloudflare.com/ai/models/${path}/index.md`,
    )
  }
  if (!res.ok) throw new Error(`Workers AI model page says ${res.status}`)
  let body = await res.text()
  let context = body.match(/Context Window[^\n]*?([\d,]+) tokens/i)
  let price = pagePrice(body)
  let speechPerThousand = speechPrice(body)
  return {
    reads: pageReads(body),
    model: {
      name,
      ...context ? { context: Number(context[1].replaceAll(',', '')) } : {},
      ...price ? { price } : {},
      ...speechPerThousand != null ? { speechPerThousand } : {},
    },
  }
}

// A model's page is read once an hour per fetch binding, the read shared by
// every caller that asks in that hour, so a stored offering never freezes an
// old price. A failed read is read again on the next ask.
let pages = new WeakMap<typeof fetch, Map<string, Promise<Info>>>()

/** How a page read is shared: the clock its hour is read from, and the hold
 * that keeps the read alive past the request that began it (@yaks/model
 * `Lent.hold`). */
export type Reading = { clock?: Clock; hold?: Hold }

let described = (
  name: string,
  fetcher: typeof fetch,
  { clock = system, hold }: Reading,
): Promise<Info> => {
  let held = pages.get(fetcher) ?? new Map()
  pages.set(fetcher, held)
  let hour = Math.floor(clock.now() / 3_600_000)
  return sharing(held, `${hour} ${name}`, () => readInfo(name, fetcher), {
    limit: 512,
    hold,
  })
}

/** Published model metadata. The speech rate is used by the native door. */
export let modelInfo = async (
  name: string,
  fetcher: typeof fetch = fetch,
  reading: Reading = {},
): Promise<Published> => (await described(name, fetcher, reading)).model

/** Native input types from the same cached model page. */
export let nativeReads = async (
  name: string,
  fetcher: typeof fetch = fetch,
  reading: Reading = {},
): Promise<Record<string, number>> =>
  (await described(name, fetcher, reading)).reads

export let listing = async (
  ai: {
    models?: (
      params?: { per_page?: number; page?: number },
    ) => Promise<Listing[]>
  },
  fetcher: typeof fetch = fetch,
  reading: Reading = {},
): Promise<Published[]> => {
  let rows = await ai.models?.({ per_page: 1000 }) ?? []
  let entries = await Promise.all(rows.map(async (row) => {
    let entry = listed(row)
    if (!speaks(row.task?.name ?? '')) return entry
    let { speechPerThousand } = await modelInfo(row.name, fetcher, reading)
    // The native door can quote speech priced by input characters.
    if (speechPerThousand != null) return { ...entry, speechPerThousand }
  }))
  return entries.filter((entry) => entry != null)
}
