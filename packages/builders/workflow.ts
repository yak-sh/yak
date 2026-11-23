// A workflow is builders reading each other's outputs: each step's query
// matches the current takes of the steps before it, and a `requires` edge from
// a step to each step it reads says so where a page can draw it. A step runs
// as soon as its own inputs exist, so the steps of one stage, none requiring
// another, run side by side. Pure: a host reads the rows and hands them here.
import type { Bundle, Comp } from '@yaks/graph'

/** One step: its builder, its name, and the steps it requires. */
export type Step = { eid: string; title: string; requires: string[] }

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** A step's name: its builder's title, or its query where it has none. */
let named = (b: Bundle): string =>
  String(comp(b, 'doc')?.title || comp(b, 'builder')?.query || b.entity.eid)

/**
 * The stages of the workflow a set of rows holds: builders and the
 * `edge{from, to}` + `requires{}` links between them, others ignored. The
 * first stage is the steps requiring none; each later stage the steps whose
 * requirements are all in the stages before. Steps caught in a loop of
 * requirements make a last stage of their own, so every builder is drawn.
 */
export let workflow = (rows: Bundle[]): Step[][] => {
  let builders = new Map(
    rows.filter((b) => comp(b, 'builder')).map((b) => [b.entity.eid, b]),
  )
  let requires = new Map(
    [...builders.keys()].map((eid) => [eid, [] as string[]]),
  )
  for (let b of rows) {
    let edge = comp(b, 'edge')
    if (!edge || !b.requires) continue
    let from = String(edge.from), to = String(edge.to)
    if (builders.has(to) && !requires.get(from)?.includes(to)) {
      requires.get(from)?.push(to)
    }
  }
  let step = (eid: string): Step => ({
    eid,
    title: named(builders.get(eid)!),
    requires: requires.get(eid)!,
  })
  let stages: Step[][] = [], placed = new Set<string>()
  let left = [...builders.keys()]
  while (left.length) {
    let ready = left.filter((eid) =>
      requires.get(eid)!.every((r) => placed.has(r))
    )
    if (!ready.length) ready = left
    stages.push(ready.map(step))
    for (let eid of ready) placed.add(eid)
    left = left.filter((eid) => !placed.has(eid))
  }
  return stages
}
