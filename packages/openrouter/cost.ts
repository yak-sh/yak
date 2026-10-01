// Speech returns bytes without usage. Its generation metadata is the billed
// amount, not a character or audio-token estimate. Metadata may lag the bytes;
// only the lookup retries, never the paid generation.
import { ModelError } from '@yaks/model'

let pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    let abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    let timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })

export let generationCost = async (
  id: string,
  options: {
    key: () => string | Promise<string>
    fetch?: typeof fetch
    signal?: AbortSignal
  },
): Promise<number> => {
  let timeout = AbortSignal.timeout(10_000)
  let signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  let headers = { authorization: 'Bearer ' + await options.key() }
  for (let attempt = 0; attempt < 4; attempt++) {
    signal.throwIfAborted()
    let response = await (options.fetch ?? fetch)(
      'https://openrouter.ai/api/v1/generation?id=' + encodeURIComponent(id),
      { headers, signal },
    )
    let cost = response.ok
      ? (await response.json())?.data?.total_cost
      : undefined
    if (typeof cost == 'number' && Number.isFinite(cost) && cost >= 0) {
      return cost
    }
    if (
      attempt < 3 && (response.ok || response.status == 404 ||
        response.status == 429 || response.status >= 500)
    ) {
      await pause(100 * 2 ** attempt, signal)
      continue
    }
    throw new ModelError(
      'cost_response',
      `OpenRouter returned no cost for ${id} (${response.status})`,
    )
  }
  throw new ModelError('cost_response', `OpenRouter returned no cost for ${id}`)
}
