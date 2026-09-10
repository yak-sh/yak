/** Identity-based tree projection. No UI or graph store dependencies. */
import type { Bundle, Comp } from '@yaks/graph'

export let parentId = (b: Bundle): string | undefined =>
  (b.spawned as Comp | undefined)?.parent as string | undefined

export let rootOf = (rows: Bundle[], id?: string): string | undefined => {
  let byId = new Map(rows.map((b) => [b.entity.eid, b]))
  let seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    let parent = byId.get(id) && parentId(byId.get(id)!)
    if (!parent || !byId.has(parent) || seen.has(parent)) return id
    id = parent
  }
  return id
}
export type TreeRow = {
  bundle: Bundle
  depth: number
  prefix: string
}
export type TreeOptions = {
  selected?: string
  showSettled?: boolean
  showArchived?: boolean
}
export let sessionTree = (
  rows: Bundle[],
  opts: TreeOptions = {},
): TreeRow[] => {
  let byId = new Map(rows.map((b) => [b.entity.eid, b]))
  let children = new Map<string, Bundle[]>()
  let roots: Bundle[] = []
  for (let b of rows) {
    let p = parentId(b)
    if (p && p != b.entity.eid && byId.has(p)) {
      let group = children.get(p) ?? []
      group.push(b)
      children.set(p, group)
    } else roots.push(b)
  }
  let path = new Set<string>()
  let id = opts.selected
  while (id && !path.has(id)) {
    path.add(id)
    id = byId.get(id) && parentId(byId.get(id)!)
  }
  let out: TreeRow[] = [], visited = new Set<string>()
  let visit = (b: Bundle, depth: number) => {
    let id = b.entity.eid
    if (visited.has(id)) return
    visited.add(id)
    if (depth == 0 && b.archived && !opts.showArchived && !path.has(id)) return
    if (
      depth > 0 && !opts.showSettled && !path.has(id) &&
      (b.session as Comp)?.status == 'settled'
    ) return
    out.push({ bundle: b, depth, prefix: '' })
    for (let child of children.get(id) ?? []) visit(child, depth + 1)
  }
  for (let root of roots) visit(root, 0)
  // Components disconnected from every root are corrupt cycles, not collapsed
  // descendants. Render each once so damaged data remains inspectable.
  let reachable = new Set<string>()
  let mark = (id: string) => {
    if (reachable.has(id)) return
    reachable.add(id)
    for (let b of children.get(id) ?? []) mark(b.entity.eid)
  }
  for (let b of roots) mark(b.entity.eid)
  for (let b of rows) {
    if (!reachable.has(b.entity.eid)) {
      mark(b.entity.eid)
      visit(b, 0)
    }
  }
  // Connect only visible rows, so filtered siblings do not leave dangling lines.
  let more = new Array<boolean>(out.length)
  let next: number[] = []
  for (let i = out.length - 1; i >= 0; i--) {
    let depth = out[i].depth
    while (next.length && out[next.at(-1)!].depth > depth) next.pop()
    more[i] = !!next.length && out[next.at(-1)!].depth == depth
    next.push(i)
  }
  let continuation: boolean[] = []
  for (let i = 0; i < out.length; i++) {
    let row = out[i]
    row.prefix = row.depth == 0
      ? ''
      : continuation.slice(1, row.depth).map((v) => v ? '│ ' : '  ').join('') +
        (more[i] ? '├─' : '└─')
    continuation[row.depth] = more[i]
  }
  return out
}
