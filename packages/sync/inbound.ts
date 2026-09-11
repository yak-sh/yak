// What the server says, landing in the local graph. A push is applied through
// the same `apply()` a local write goes through — trusted, because the server
// is where the stamps and the numbers were minted — and marked as an echo so
// the outbound hook does not send it straight back.
//
// `gone` is the half no client could work out for itself: an entity that LEFT
// a subscription's set, whether it was deleted or merely stopped matching. The
// frame does not say which, so this module strips the entity of its components
// rather than tombstoning it: a stripped entity matches no query — which is
// what "left the set" means — and can come back whole when it matches again,
// where a tombstone could never be lifted. A DELETE still tombstones, because
// a real death arrives as a `tombstone` component in the bundles.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { comps, dead, detached, then, transient } from '@yaks/graph'
import { echo } from './mark.ts'
import type { Frame } from './socket.ts'
import { tierOf } from './tier.ts'

// A patch that takes server components off an entity, preserving local state. The
// entity is then invisible to every query, which is the local shape of "no
// longer in the set".
let bare = (graph: Graph, b: Bundle): Bundle[] => {
  if (dead(b)) return [] // already in the grave; nothing left to take
  let out: Bundle = { entity: { eid: b.entity.eid } }
  for (let [name] of comps(b)) {
    if (tierOf(graph.vocab, name) == 'wire') out[name] = null
  }
  return comps(out).length ? [out] : []
}

/**
 * Take these entities out of the local graph: their wire-tier components are
 * dropped, their identity stays. What a subscription's `gone` list means.
 */
export let strip = (
  graph: Graph,
  eids: Eid[],
): Bundle[] | Promise<Bundle[]> =>
  then(detached(graph.storage).get(eids), (held) => {
    let out = held.flatMap((b) => bare(graph, b))
    return out.length ? graph.apply(echo(out), { trusted: true }) : []
  })

/**
 * One frame from the server, landed: the bundles it carries are applied whole
 * and trusted, and the entities it says are gone are stripped. A refused
 * subscription changes nothing in the graph — it is reported, not applied.
 */
export let land = (
  graph: Graph,
  frame: Frame,
): Bundle[] | Promise<Bundle[]> => {
  if (frame.refused) return []
  const live = transient(graph)
  let bundles = frame.bundles ?? []
  let gone = frame.gone ?? []
  live.forget([...gone, ...frame.transientReset ?? []])
  return then(
    bundles.length ? graph.apply(echo(bundles), { trusted: true }) : [],
    (applied) => {
      for (const update of frame.transient ?? []) live.receive(update)
      return gone.length
        ? then(strip(graph, gone), (out) => [...applied, ...out])
        : applied
    },
  )
}

/** Replace the wire tier with a query's whole rows, including absent columns.
 * Raw feeds are patches and must use land() instead. Local/none never come
 * from the server, and are never removed by a query snapshot. */
export let snapshot = (
  graph: Graph,
  bundles: Bundle[],
): Bundle[] | Promise<Bundle[]> =>
  then(
    detached(graph.storage).get(bundles.map((b) => b.entity.eid)),
    (held) => {
      let previous = new Map(held.map((b) => [b.entity.eid, b]))
      let patches = bundles.map((b) => {
        if (dead(b)) return b
        let out: Bundle = { entity: b.entity }
        for (
          let [name, comp] of comps(
            previous.get(b.entity.eid) ?? { entity: b.entity },
          )
        ) {
          if (tierOf(graph.vocab, name) != 'wire') continue
          out[name] = b[name] == null ? null : Object.fromEntries(
            Object.keys(comp ?? {}).map((key) => [key, null]),
          )
        }
        for (let [name, comp] of comps(b)) {
          if (tierOf(graph.vocab, name) == 'wire') {
            out[name] = comp == null
              ? null
              : { ...(out[name] as Comp ?? {}), ...comp }
          }
        }
        return out
      })
      return patches.length ? graph.apply(echo(patches), { trusted: true }) : []
    },
  )
