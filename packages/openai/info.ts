// The credential's catalogue establishes availability. OpenAI's public model
// page supplies token limits the /models API does not return; our shared tariff
// table supplies pricing, as it does for Anthropic's own model descriptions.
import { type Listed, listPrice, ModelError } from '@yaks/model'

let number = (body: string, patterns: RegExp[]): number | undefined => {
  let found = patterns.map((pattern) => body.match(pattern)?.[1]).find(Boolean)
  return found ? Number(found.replaceAll(',', '')) : undefined
}

/** The total context window takes precedence over the model's input-only cap. */
export let limits = (body: string): Pick<Listed, 'context' | 'output'> => {
  let context = number(body, [
    /([\d,]+)\s+context window/i,
    /Context window:\s*([\d,]+)/i,
    /Maximum input tokens:\s*([\d,]+)/i,
    /Max input:\s*([\d,]+)/i,
  ])
  let output = number(body, [
    /([\d,]+)\s+max output tokens/i,
    /Max output:\s*([\d,]+)/i,
  ])
  return {
    ...context ? { context } : {},
    ...output ? { output } : {},
  }
}

let page = async (name: string, fetcher: typeof fetch): Promise<string> => {
  let res = await fetcher(
    `https://developers.openai.com/api/docs/models/${
      encodeURIComponent(name)
    }.md`,
  )
  if (res.status == 404) {
    await res.body?.cancel()
    let alias = name.replace(/-\d{4}-\d{2}-\d{2}$/, '')
    return alias == name ? '' : page(alias, fetcher)
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new ModelError('metadata', `OpenAI model page says ${res.status}`)
  }
  return res.text()
}

/** Enrich a model the credential already listed, keeping API limits first. */
export let described = async (
  model: Listed,
  fetcher: typeof fetch = fetch,
): Promise<Listed> => {
  let price = model.price ?? listPrice(model.name)
  let published = model.context != null
    ? {}
    : limits(await page(model.name, fetcher))
  return { ...published, ...model, ...price ? { price } : {} }
}
