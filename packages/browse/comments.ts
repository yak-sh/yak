// Comments form branches on one thread. Missing parents and malformed cycles
// stay visible as roots; grouping never drops somebody's words.
import type { Ent } from './types.ts'

export type Branch = { row: Ent; children: Branch[] }

export let branches = (rows: Ent[]): Branch[] => {
  let ordered = [...rows].sort((a, b) =>
    String(a.created?.at ?? '').localeCompare(String(b.created?.at ?? '')) ||
    a.num - b.num || a.eid.localeCompare(b.eid)
  )
  let nodes = new Map<string, Branch>(
    ordered.map((row) => [row.eid, { row, children: [] }]),
  )
  let parents = new Map<string, string>()
  for (let row of ordered) {
    let parent = nodes.get(row.comment?.reply_to ?? '')?.row
    if (parent?.comment && parent.comment.target == row.comment?.target) {
      parents.set(row.eid, parent.eid)
    }
  }
  let done = new Set<string>()
  for (let row of ordered) {
    let path = new Set<string>(), at: string | undefined = row.eid
    while (at && !done.has(at)) {
      if (path.has(at)) {
        parents.delete(at)
        break
      }
      path.add(at)
      at = parents.get(at)
    }
    for (let eid of path) done.add(eid)
  }
  let roots: Branch[] = []
  for (let [eid, node] of nodes) {
    let parent = nodes.get(parents.get(eid) ?? '')
    let into = parent ? parent.children : roots
    into.push(node)
  }
  return roots
}
