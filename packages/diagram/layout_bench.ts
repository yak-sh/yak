// Laying out a whole site's worth of entities: none linked, a chain, and a
// tree where each names an earlier one.
import { layout } from './mod.ts'

let eid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let site = (n: number, parent: (i: number) => number | null) =>
  Array.from({ length: n }, (_, i) => {
    let p = parent(i)
    return {
      entity: { eid: eid(i) },
      doc: { title: `section ${i}` },
      ...(p == null ? {} : { comment: { target: eid(p) } }),
    }
  })

let shapes = {
  apart: () => null,
  chain: (i: number) => i ? i - 1 : null,
  tree: (i: number) => i ? Math.floor(i / 3) : null,
}
for (let [name, parent] of Object.entries(shapes)) {
  let bundles = site(200, parent)
  Deno.bench(`layout of 200 entities, ${name}`, () => {
    layout(bundles)
  })
}
