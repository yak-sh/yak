// What this node is saying: each `sync: peers` value it relayed and has not
// cleared, whole, as the server should be holding it.
//
// The server holds a relayed value under the connection that last said it
// (@yaks/api relay.ts), so a new connection holds nothing, and the one before
// it may still be open there, holding what this node said on it. So on every
// connection this node says again what it is saying, before it subscribes to
// anything: the new connection takes each value over, the old one's close
// clears none of them, and no answer hands this node back an older copy of its
// own. A clear that no connection carried is said again too, once.
//
// A connection is never told what it is saying itself, so an answer leaves
// these values out, and their absence from a reset frame says nothing
// (inbound.ts `hear`). A value heard from another connection takes that one
// over: the last writer holds it, so it is no longer this node's to say.

import type { Bundle, Eid } from '@yaks/graph'
import { comps } from '@yaks/graph'
import { bundled, key, type Said } from './pace.ts'

/** Whether this node is saying one component of one entity. */
export type Mine = (eid: Eid, comp: string) => boolean

/** What this node is saying, kept across its connections. */
export type Saying = {
  /** a committed write's relayed bundles; `carried` is whether a connection
   * is open to take them now */
  wrote: (bundles: Bundle[], carried: boolean) => void
  /** relayed bundles heard from another connection */
  heard: (bundles: Bundle[]) => void
  /** whether this node is saying this component of this entity */
  mine: Mine
  /** everything to say again on a new connection */
  again: () => Bundle[]
}

export let saying = (): Saying => {
  let said = new Map<string, Said>()
  return {
    wrote: (bundles, carried) => {
      for (let b of bundles) {
        let eid = b.entity.eid
        for (let [comp, patch] of comps(b)) {
          let k = key(eid, comp)
          if (patch != null) {
            let was = said.get(k)?.[2]
            said.set(k, [eid, comp, { ...was, ...patch }])
          } else if (carried) said.delete(k)
          else said.set(k, [eid, comp, null])
        }
      }
    },
    heard: (bundles) => {
      for (let b of bundles) {
        for (let [comp] of comps(b)) said.delete(key(b.entity.eid, comp))
      }
    },
    mine: (eid, comp) => said.get(key(eid, comp))?.[2] != null,
    again: () => {
      let out = bundled([...said.values()])
      for (let [k, [, , patch]] of said) if (patch == null) said.delete(k)
      return out
    },
  }
}
