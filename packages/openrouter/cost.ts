// Speech returns bytes without usage. Its generation metadata is the billed
// amount, not a character or audio-token estimate.
import { ModelError } from '@yaks/model'

export let generationCost = async (
  id: string,
  options: {
    key: () => string | Promise<string>
    fetch?: typeof fetch
    signal?: AbortSignal
  },
): Promise<number> => {
  let response = await (options.fetch ?? fetch)(
    'https://openrouter.ai/api/v1/generation?id=' + encodeURIComponent(id),
    {
      headers: { authorization: 'Bearer ' + await options.key() },
      signal: options.signal,
    },
  )
  if (!response.ok) {
    throw new ModelError(
      'cost_response',
      `OpenRouter cost lookup failed (${response.status}) for ${id}`,
    )
  }
  let value = await response.json()
  let cost = value?.data?.total_cost
  if (typeof cost != 'number' || !Number.isFinite(cost) || cost < 0) {
    throw new ModelError('cost_response', `OpenRouter returned no cost for ${id}`)
  }
  return cost
}
