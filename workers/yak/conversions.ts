// Telling an ad network what the visit its click brought went on to do
// (T-144220): a marketing page seen, a sign-up. Sent from the Worker, after the
// answer, so a visitor's browser loads no ad network's code and waits on
// nothing. Only the network whose click id the arrival carries is told, and a
// visit no ad sent is told to nobody (arrival.ts `conversionOf`).
//
// A network is data and one function: the click id it appends, and the request
// that tells it one conversion, or none where it is not set up. ads.ts names
// the networks yaks.app tells.
import type { Env } from './env.ts'
import type { Conversion } from './arrival.ts'
import { caught } from './defects.ts'

export type Network = {
  name: string
  /** The parameter its ad links carry its click id in. */
  click: string
  /** The request that tells it this conversion, or null where it isn't set
   * up on this Worker. */
  request: (c: Conversion, click: string, env: Env) => Request | null
}

/**
 * Tell each network whose click brought this visit. A network that refuses is
 * one report, never a broken page: nothing waits on it but the runtime.
 */
export let tell = async (
  env: Env,
  c: Conversion,
  networks: Network[],
  send: typeof fetch = fetch,
) => {
  await Promise.all(networks.map(async (n) => {
    let click = c.came.said[n.click]
    let req = click ? n.request(c, click, env) : null
    if (!req) return
    try {
      let res = await send(req)
      if (!res.ok) {
        throw new Error(
          `${n.name} refused a ${c.told}: HTTP ${res.status}: ${
            (await res.text()).slice(0, 300)
          }`,
        )
      }
      await res.body?.cancel()
    } catch (e) {
      caught(e, { request: `conversion ${n.name}` })
    }
  }))
}
