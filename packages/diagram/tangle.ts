// What makes a drawing hard to read, found in a layout as svg() draws it: two
// shapes too close, a line through a shape it does not end at, two lines that
// cross or run over each other, and names written over shapes or each other. Pure: a layout in, a list of
// what is tangled out, each said with the short ids a person reads.
import { APART, type Layout } from './layout.ts'
import { cross, type Spot } from './geometry.ts'
import { curves } from './pen.ts'
import { half, on, tag } from './shape.ts'

// The points a curve is checked at: enough that a line through the corner of
// a shape is still seen.
const STEPS = 24

/**
 * Everything tangled in a layout: shapes closer than `APART`, a line through a
 * shape that is not one of its ends, lines that cross, lines that run within
 * a few units of each other, and a line's name on a shape or on another
 * name. Each is said with the short ids it involves.
 *
 * ```ts
 * import { layout, tangles } from '@yaks/diagram'
 * import { equal } from '@yaks/testing'
 *
 * let a = { entity: { eid: '0a' }, doc: { title: 'Dune' } }
 * let b = { entity: { eid: '0b' }, review: { of: '0a' } }
 * equal(tangles(layout([a, b])), [])
 * ```
 */
export let tangles = (layout: Layout): string[] => {
  let out: string[] = []
  let at = new Map(layout.nodes.map((n) => [n.eid, n]))
  let size = new Map(
    layout.nodes.map((n) => [n.eid, half(n.shape, !!n.state)]),
  )
  let name = (eid: string) => at.get(eid)?.label ?? eid
  let nodes = layout.nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      let a = nodes[i], b = nodes[j]
      let [aw, ah] = size.get(a.eid)!, [bw, bh] = size.get(b.eid)!
      if (
        Math.abs(a.x - b.x) < aw + bw + APART &&
        Math.abs(a.y - b.y) < ah + bh + APART
      ) out.push(`${a.label} is too close to ${b.label}`)
    }
  }
  let lines = curves(layout)
  let paths = layout.links.map((l) => {
    let c = lines.get(l.key)!
    let pts = Array.from({ length: STEPS + 1 }, (_, i) => on(c, i / STEPS))
    return { l, pts, said: `${name(l.from)} ${l.name} ${name(l.to)}` }
  })
  for (let { l, pts, said } of paths) {
    for (let n of nodes) {
      if (n.eid == l.from || n.eid == l.to) continue
      let [w, h] = size.get(n.eid)!
      if (
        pts.some(([x, y]) => Math.abs(x - n.x) < w && Math.abs(y - n.y) < h)
      ) {
        out.push(`${said} runs through ${n.label}`)
      }
    }
  }
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      let a = paths[i], b = paths[j]
      let shared = [a.l.from, a.l.to].filter((e) =>
        e == b.l.from || e == b.l.to
      )
      let crossed = !shared.length &&
        a.pts.some((p, k) =>
          k > 0 &&
          b.pts.some((q, m) => m > 0 && cross(a.pts[k - 1], p, b.pts[m - 1], q))
        )
      if (crossed) {
        out.push(`${a.said} crosses ${b.said}`)
        continue
      }
      // Lines that share an end meet there; past their first and last
      // stretch they should be apart.
      let inner = (pts: Spot[]) => pts.slice(4, -4)
      let near = inner(a.pts).some(([x, y]) =>
        inner(b.pts).some(([u, v]) => Math.hypot(x - u, y - v) < 6)
      )
      if (near) out.push(`${a.said} runs over ${b.said}`)
    }
  }
  // Each line's name, as svg() writes it.
  let tags = paths.map(({ l, said }) => ({
    said,
    box: tag(lines.get(l.key)!, l.mid, l.name, l.eid && (l.label ?? '')).box,
  }))
  for (let [i, { said, box: [x0, y0, x1, y1] }] of tags.entries()) {
    for (let n of nodes) {
      let [w, h] = size.get(n.eid)!
      if (x0 < n.x + w && x1 > n.x - w && y0 < n.y + h && y1 > n.y - h) {
        out.push(`the name of ${said} sits on ${n.label}`)
      }
    }
    for (let o of tags.slice(i + 1)) {
      let [u0, v0, u1, v1] = o.box
      if (x0 < u1 && u0 < x1 && y0 < v1 && v0 < y1) {
        out.push(`the names of ${said} and ${o.said} sit on each other`)
      }
    }
  }
  return out
}
