// The Operator page's half of its store's door (operator-api.ts): @yaks/api's
// `/apply` and `/query`, asked once. It runs in the browser as part of
// `_talk.js` (assets.ts).
import type { Bundle } from '@yaks/graph'

/** How long a write waits on its door before it is given up, ms: a request
 * the network holds unanswered fails in seconds, and is sent again. */
export let WAIT = 10_000

/** The store of the Operator whose page is at `url` (its origin and path),
 * as the page's person reads and writes it at once: a batch applied, and the
 * rows a query answers now. What the page watches is in its page graph. */
export let operatorAt = (url: string, signal?: AbortSignal) => ({
  /** One batch, answered as the store applied it; a refusal throws its
   * words. */
  apply: async (bundles: Bundle[]) => {
    let response = await fetch(`${url}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundles),
      signal: AbortSignal.timeout(WAIT),
    })
    let answer = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(
        (answer as { message?: string } | null)?.message ??
          `The store answered ${response.status}`,
      )
    }
    return { bundles: answer as Bundle[] }
  },
  /** The rows `query` answers now, as the person may read them. */
  query: async (query: string): Promise<Bundle[]> => {
    let wait = AbortSignal.timeout(WAIT)
    let response = await fetch(`${url}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: query }),
      signal: signal ? AbortSignal.any([signal, wait]) : wait,
    })
    if (!response.ok) throw new Error(`The store answered ${response.status}`)
    return await response.json() as Bundle[]
  },
})
