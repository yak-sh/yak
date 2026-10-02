// Speech returns bytes without usage. Its generation metadata is the billed
// amount, not a character or audio-token estimate. Metadata may lag the bytes;
// only the lookup retries, never the paid generation.
import { ModelError } from '@yaks/model'

// Generation metadata for speech lands seconds after the bytes.
let LAG = 20_000

let obj = (value: unknown): Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}

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
  let deadline = Date.now() + LAG
  let signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(LAG)])
    : AbortSignal.timeout(LAG)
  let headers = { authorization: 'Bearer ' + await options.key() }
  for (let attempt = 0;; attempt++) {
    signal.throwIfAborted()
    let response = await (options.fetch ?? fetch)(
      'https://openrouter.ai/api/v1/generation?id=' + encodeURIComponent(id),
      { headers, signal },
    )
    let cost = response.ok
      ? obj(obj(await response.json()).data).total_cost
      : undefined
    if (typeof cost == 'number' && Number.isFinite(cost) && cost >= 0) {
      return cost
    }
    let wait = Math.min(250 * 2 ** attempt, 1500)
    if (
      Date.now() + wait < deadline &&
      (response.ok || response.status == 404 || response.status == 429 ||
        response.status >= 500)
    ) {
      await pause(wait, signal)
      continue
    }
    throw new ModelError(
      'cost_response',
      `OpenRouter returned no cost for ${id} (${response.status})`,
    )
  }
}
