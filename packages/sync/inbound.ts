// What the server pushes, applied to the local graph. An incoming frame goes
// through the same `apply()` a local write goes through — trusted, because the
// server is where the stamped properties and the numbers were written — and
// marked as an echo so the outbound hook does not send it straight back.
//
// `gone` is the part no client could work out for itself: an entity that left a
// subscription's set, whether it was deleted or merely stopped matching. The
// frame does not distinguish the two, so this module removes the entity's
// components rather than tombstoning it: an entity with no components matches
// no query — which is what leaving the set means — and it can come back whole
// when it matches again, where a tombstone could never be lifted. A deletion
// still tombstones, because a deletion arrives as a `tombstone` component in
// the frame's bundles.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { comps, dead, detached, then, transient } from '@yaks/graph'
import { replicate } from './mark.ts'
import type { Frame } from './socket.ts'
import { type Coverage, covers } from './coverage.ts'
import { outbound } from './tier.ts'

// A patch that removes an entity's server-owned components, leaving its local
// state alone. The entity is then invisible to every query, which is what "no
// longer in the set" looks like locally.
let bare = (graph: Graph, b: Bundle): Bundle[] => {
  if (dead(b)) return [] // already tombstoned; nothing left to remove
  let out: Bundle = { entity: { eid: b.entity.eid } }
  for (let [name] of comps(b)) {
    if (outbound(graph.vocab, name)) out[name] = null
  }
  return comps(out).length ? [out] : []
}

/**
 * Take these entities out of the local graph: their server-owned components are
 * dropped, their identity stays. This is what a subscription's `gone` list
 * means.
 */
export let strip = (
  graph: Graph,
  eids: Eid[],
): Bundle[] | Promise<Bundle[]> =>
  then(detached(graph.storage).get(eids), (held) => {
    let out = held.flatMap((b) => bare(graph, b))
    return out.length ? replicate(graph, out) : []
  })

/**
 * One frame from the server, applied: the bundles it carries go in whole and
 * trusted, and the entities it lists as gone have their components removed. A
 * refused subscription changes nothing in the graph — it is reported, not
 * applied.
 */
export let land = (
  graph: Graph,
  frame: Frame,
): Bundle[] | Promise<Bundle[]> => {
  if (frame.refused) return []
  if (frame.coverage || frame.peerCoverage || frame.peers || frame.peerGone) {
    throw new Error('coverage/rider delivery requires a working-set replica')
  }
  const live = transient(graph)
  let bundles = frame.bundles ?? []
  let gone = frame.gone ?? []
  live.forget([...gone, ...frame.transientReset ?? []])
  return then(
    bundles.length ? replicate(graph, bundles) : [],
    (applied) => {
      for (const update of frame.transient ?? []) live.receive(update)
      return gone.length
        ? then(strip(graph, gone), (out) => [...applied, ...out])
        : applied
    },
  )
}

/** Replace the server-owned components with a query's whole rows, including
 * the properties it reports as absent. A raw feed carries patches instead, and
 * must use land(). `sync: none` components never come from the server, and a
 * query snapshot never removes them. */
export let snapshot = (
  graph: Graph,
  bundles: Bundle[],
  opts: {
    coverage?: Record<Eid, Coverage>
    /** Lets another owner of a property keep it when this snapshot omits it. */
    preserve?: (eid: Eid, name: string, prop?: string) => boolean
  } = {},
): Bundle[] | Promise<Bundle[]> =>
  then(
    detached(graph.storage).get(bundles.map((b) => b.entity.eid)),
    (held) => {
      let previous = new Map(held.map((b) => [b.entity.eid, b]))
      let patches = bundles.map((b) => {
        if (dead(b)) return b
        let out: Bundle = { entity: b.entity }
        let scope = opts.coverage?.[b.entity.eid] ?? true
        let keep = (name: string, prop?: string) =>
          opts.preserve?.(b.entity.eid, name, prop) ?? false
        for (let [name, comp] of comps(previous.get(b.entity.eid) ?? out)) {
          if (!outbound(graph.vocab, name)) continue
          if (!covers(scope, name)) continue
          if (
            b[name] == null && (scope === true || scope[name] === true) &&
            !keep(name)
          ) {
            out[name] = null
          } else {
            let cut = Object.fromEntries(
              Object.keys(comp ?? {}).filter((key) =>
                covers(scope, name, key) && !keep(name, key)
              ).map((key) => [key, null]),
            )
            if (Object.keys(cut).length) out[name] = cut
          }
        }
        for (let [name, comp] of comps(b)) {
          if (
            !outbound(graph.vocab, name) || !covers(scope, name)
          ) continue
          out[name] = comp == null ? null : {
            ...(out[name] as Comp ?? {}),
            ...Object.fromEntries(
              Object.entries(comp).filter(([key]) => covers(scope, name, key)),
            ),
          }
        }
        return out
      })
      return patches.length ? replicate(graph, patches) : []
    },
  )
