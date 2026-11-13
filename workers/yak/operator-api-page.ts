// The Operator page's half of its store's door (operator-api.ts): @yaks/api's
// `/apply`, and the rows each query answers held on one socket, @yaks/sync's
// wire, which opens its subscriptions again whenever it reconnects. It is what
// a draft desk asks of a store (@yaks/draft `Store`), and runs in the browser
// as part of `_talk.js` (client-assets.ts).
import type { Bundle } from '@yaks/graph'
import { wire } from '@yaks/sync/socket'

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
) => {
  let held = new Map<
    string,
    { rows: Map<string, Bundle>; hear: (rows: Bundle[]) => void }
  >()
  let link = wire({
    url,
    report,
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
          answer?.message ?? `The store answered ${response.status}`,
        )
      }
      return { bundles: answer as Bundle[] }
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
    /** Be told each time its socket opens (true) or closes under it. */
    connected: (fn: (open: boolean) => void) => link.onConnection(fn),
    close: () => link.close(),
  }
}
