// A one-time store read for a page that keeps its current view while the
// store wakes. An unanswered read is never an empty result: the gate uses an
// empty result to decide that this person has no hero yet, and the local graph
// needs every word before it can answer a query.
import { type Clock, sleep, system } from '@yaks/fp'

/** How the store is asked (default: the global `fetch`). */
export type Get = (url: URL, init: RequestInit) => Promise<Response>

// One ask: the rows, or null when the store did not answer and is asked again.
let attempt = async <T>(
  url: URL,
  get: Get,
  signal: AbortSignal,
): Promise<T[] | null> => {
  let answer: Response
  try {
    answer = await get(url, { signal })
  } catch (e) {
    console.warn('mossvale store:', url.pathname + url.search, e)
    return null
  }
  if (answer.status >= 500) {
    console.warn('mossvale store:', url.pathname + url.search, answer.status)
    return null
  }
  if (!answer.ok) {
    throw new Error(`${answer.status} ${answer.statusText}`)
  }
  let rows: unknown = await answer.json()
  if (!Array.isArray(rows)) throw new Error('store query did not answer rows')
  return rows as T[]
}

export let once = async <T>(
  url: URL,
  get: Get = fetch,
  clock: Clock = system,
): Promise<T[]> => {
  for (;;) {
    // AbortSignal.timeout, on this clock: an ask has eight seconds.
    let late = new AbortController()
    let cancel = clock.after(
      8000,
      () => late.abort(new DOMException('signal timed out', 'TimeoutError')),
    )
    let rows = await attempt<T>(url, get, late.signal).finally(cancel)
    if (rows) return rows
    await sleep(1000, undefined, clock)
  }
}
