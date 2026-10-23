// Putting a link in its place in a list.
//
// Where order matters, a link's position among the others of its list is its
// `edge.ord`. A list is drawn in some order (by position, then by whatever
// its reader breaks ties with), and a person moves a row within it, or brings
// one in from elsewhere: `placed` says what to write so the list reads in the
// new order. A move between neighbours that each have a position writes the
// moved link alone, halfway between them, so a move is one write. A list
// whose links have no positions yet, or the same one, is numbered from 1 in
// its new order the first time, writing only the links whose position changes.

import type { Bundle } from '@yaks/graph'
import { EDGE } from './relations.ts'

let ordOf = (b: Bundle): number | undefined => {
  let ord = (b[EDGE] as { ord?: unknown } | null | undefined)?.ord
  return typeof ord == 'number' ? ord : undefined
}

/**
 * The bundles that put `put` at `at` among the other links of a list, given
 * in the order it is drawn. `put` is one of them, moving, or a link joining
 * the list (`link()`), which is written whole with its position.
 */
/// placed([], { entity: { eid: 'e' }, edge: { from: 'p', to: 'a' } }, 0)[0].edge
///   -> { from: 'p', to: 'a', ord: 1 }
export let placed = (links: Bundle[], put: Bundle, at: number): Bundle[] => {
  let id = put.entity.eid
  let joins = !links.some((b) => b.entity.eid == id)
  let rest = links.filter((b) => b.entity.eid != id)
  let i = Math.max(0, Math.min(at, rest.length))
  let ords = rest.map(ordOf)
  let rising = ords.every((o, k) => o != null && (k == 0 || o > ords[k - 1]!))
  let [p, n] = [ords[i - 1], ords[i]]
  let mid = p == null ? n == null ? 1 : n - 1 : n == null ? p + 1 : (p + n) / 2
  let set = (b: Bundle, ord: number): Bundle =>
    b.entity.eid == id && joins
      ? { ...b, [EDGE]: { ...b[EDGE] as object, ord } }
      : { entity: { eid: b.entity.eid }, [EDGE]: { ord } }
  if (rising && mid != p && mid != n) return [set(put, mid)]
  return [...rest.slice(0, i), put, ...rest.slice(i)].flatMap((b, k) =>
    ordOf(b) == k + 1 && !(b.entity.eid == id && joins) ? [] : [set(b, k + 1)]
  )
}
