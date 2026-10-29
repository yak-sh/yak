// The link vocabulary supplies its derivation. Generic writes use that seam
// rather than importing an edge package or duplicating its identity formula.
import type { Bundle, Comp } from './bundle.ts'
import type { Graph } from './graph.ts'
import { deriving } from './identity.ts'
import { Refused } from './errors.ts'
import { mint } from './mint.ts'

/** A relationship to add or remove. */
export type Link = {
  from: string
  relation: string
  to: string
  drop?: boolean
  ord?: number
  props?: Comp
}

/** Compile relationships using the graph's composed edge implementation. */
export let linked = async (graph: Graph, links: Link[]): Promise<Bundle[]> => {
  if (!links.length) return []
  let derive = deriving(graph.vocab, graph.plugins).edge
  if (!derive) throw new Refused('this graph has no edge implementation')
  let ids = links.flatMap(({ from, to }) => [from, to])
    .filter((id) => !id.startsWith('$'))
  let addresses = await graph.address(ids)
  let idOf = (id: string) => addresses.get(id) ?? id
  return links.map(({ from, relation, to, drop, ord, props }) => {
    let edge: Comp = {
      from: idOf(from),
      to: idOf(to),
      ...(ord === undefined ? {} : { ord }),
    }
    let b: Bundle = {
      entity: { eid: `$link-${mint()}` },
      edge,
      [relation]: props ?? {},
    }
    if (!drop) return b
    return { ...b, $delete: true }
  })
}
