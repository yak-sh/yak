// The Operator page's half of its store's door (operator-api.ts): @yaks/api's
// `/apply`, and the rows each query answers held on one socket, @yaks/sync's
// wire, which opens its subscriptions again whenever it reconnects. It is what
// a draft desk asks of a store (@yaks/draft `Store`), and runs in the browser
// as part of `_talk.js` (assets.ts).
import type { Bundle } from '@yaks/graph'
import { type Timer, wire } from '@yaks/sync/socket'

/** How long a write waits on its door before it is given up, ms: a request
 * the network holds unanswered fails in seconds, and is sent again. */
export let WAIT = 10_000

/** The store of the Operator whose page is at `url` (its origin and path), as
 * `person` reads and writes it, telling `report` what went wrong on its
 * socket. */
export let storeAt = (
  url: string,
  person: string,
  report: (error: unknown) => void,
  { signal, timer }: { signal?: AbortSignal; timer?: Timer } = {},
) => {
  let held = new Map<
    string,
    { rows: Map<string, Bundle>; hear: (rows: Bundle[]) => void }
  >()
  let link = wire({
    url,
    report,
    timer,
    land: (frame) => {
      let sub = held.get(frame.id)
      if (!sub) return
      if (frame.refused) return report(new Error(frame.refused.message))
      if (frame.reset) sub.rows.clear()
      for (let b of frame.bundles ?? []) sub.rows.set(b.entity.eid, b)
      for (let eid of frame.gone ?? []) sub.rows.delete(eid)
      sub.hear([...sub.rows.values()])
    },
  })
  return {
    me: () => Promise.resolve({ person }),
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
    /** The rows `query` answers now, and again each time they change; the
     * function returned ends it. */
    subscribe: (query: string, hear: (rows: Bundle[]) => void) => {
      let id = link.subscribe(query)
      held.set(id, { rows: new Map(), hear })
      return () => {
        held.delete(id)
        link.unsubscribe(id)
      }
    },
    /** Its socket's state now, and each time it opens or closes under it. */
    connected: (fn: (open: boolean) => void) => {
      let off = link.onConnection(fn)
      fn(link.connected())
      return off
    },
    close: () => link.close(),
  }
}
