// Comments form branches on one thread. Missing parents and malformed cycles
// stay visible as roots; grouping never drops somebody's words.
import type { Bundle } from '@yaks/graph'

export type CommentRow = Bundle & {
  created?: { at?: string; by?: string; via?: string }
  comment?: { target: string; reply_to?: string }
}

export type Branch = { row: CommentRow; children: Branch[] }

export let branches = (rows: CommentRow[]): Branch[] => {
  let ordered = [...rows].sort((a, b) =>
    String(a.created?.at ?? '').localeCompare(String(b.created?.at ?? '')) ||
    (a.entity.num ?? 0) - (b.entity.num ?? 0) || a.entity.eid.localeCompare(b.entity.eid)
  )
  let nodes = new Map<string, Branch>(
    ordered.map((row) => [row.entity.eid, { row, children: [] }]),
  )
  let parents = new Map<string, string>()
  for (let row of ordered) {
    let parent = nodes.get(row.comment?.reply_to ?? '')?.row
    if (parent?.comment && parent.comment.target == row.comment?.target) {
      parents.set(row.entity.eid, parent.entity.eid)
    }
  }
  let done = new Set<string>()
  for (let row of ordered) {
    let path = new Set<string>(), at: string | undefined = row.entity.eid
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
