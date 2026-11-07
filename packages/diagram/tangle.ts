// What makes a drawing hard to read, found in a layout as svg() draws it: two
// shapes too close, a line through a shape it does not end at, two lines that
// cross or run over each other, and names written over shapes or each other. Pure: a layout in, a list of
// what is tangled out, each said with the short ids a person reads.
import type { Layout } from './layout.ts'
import { cross, type Spot } from './geometry.ts'
import { curves } from './pen.ts'
import { APART, half, on, tag } from './shape.ts'

// The points a curve is checked at: enough that a line through the corner of
// a shape is still seen.
const STEPS = 24

let once = <T>(make: () => T) => {
  let made: T | undefined
  return () => made ??= make()
}

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
export let tangles = (layout: Layout): string[] =>
  knots(layout).map((k) => k.said)

/** A tangle, said as {@link tangles} says it, and the shapes and lines it
 * involves, by their keys: a node's eid, a link's key. */
export type Knot = { said: string; keys: string[] }

/** Everything tangled in a layout, as {@link tangles} finds it, with what
 * each involves; with `only`, just the tangles that involve one of those
 * keys. */
export let knots = (layout: Layout, only?: ReadonlySet<string>): Knot[] => {
  let out: Knot[] = []
  let asked = (...keys: string[]) => !only || keys.some((k) => only.has(k))
  let knot = (said: string, ...keys: string[]) => out.push({ said, keys })
  let at = new Map(layout.nodes.map((n) => [n.eid, n]))
  let size = new Map(
    layout.nodes.map((n) => [n.eid, half(n.shape, !!n.state)]),
  )
  let name = (eid: string) => at.get(eid)?.label ?? eid
  let nodes = layout.nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      let a = nodes[i], b = nodes[j]
      if (!asked(a.eid, b.eid)) continue
      let [aw, ah] = size.get(a.eid)!, [bw, bh] = size.get(b.eid)!
      if (
        Math.abs(a.x - b.x) < aw + bw + APART &&
        Math.abs(a.y - b.y) < ah + bh + APART
      ) knot(`${a.label} is too close to ${b.label}`, a.eid, b.eid)
    }
  }
  let lines = curves(layout)
  // Each line's points and name are worked out only when something near
  // could meet them.
  let paths = layout.links.map((l) => {
    let c = lines.get(l.key)!
    let xs = [c.x0, c.cx, c.x1], ys = [c.y0, c.cy, c.y1]
    // Its bounds (a curve stays within its control points), as far out as a
    // line beside it still runs over it.
    let box = [
      Math.min(...xs) - 6,
      Math.min(...ys) - 6,
      Math.max(...xs) + 6,
      Math.max(...ys) + 6,
    ]
    return {
      l,
      box,
      pts: once(() =>
        Array.from({ length: STEPS + 1 }, (_, i) => on(c, i / STEPS))
      ),
      named: once(() => tag(c, l.mid, l.name, l.eid && (l.label ?? '')).box),
      said: `${name(l.from)} ${l.name} ${name(l.to)}`,
    }
  })
  let apart = (a: number[], b: number[]) =>
    a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]
  for (let { l, pts, box, said } of paths) {
    for (let n of nodes) {
      if (n.eid == l.from || n.eid == l.to || !asked(l.key, n.eid)) continue
      let [w, h] = size.get(n.eid)!
      if (apart(box, [n.x - w, n.y - h, n.x + w, n.y + h])) continue
      if (
        pts().some(([x, y]) => Math.abs(x - n.x) < w && Math.abs(y - n.y) < h)
      ) {
        knot(`${said} runs through ${n.label}`, l.key, n.eid)
      }
    }
  }
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      let a = paths[i], b = paths[j]
      if (!asked(a.l.key, b.l.key) || apart(a.box, b.box)) continue
      let shared = [a.l.from, a.l.to].filter((e) =>
        e == b.l.from || e == b.l.to
      )
      let [ap, bp] = [a.pts(), b.pts()]
      let crossed = !shared.length &&
        ap.some((p, k) =>
          k > 0 && bp.some((q, m) => m > 0 && cross(ap[k - 1], p, bp[m - 1], q))
        )
      if (crossed) {
        knot(`${a.said} crosses ${b.said}`, a.l.key, b.l.key)
        continue
      }
      // Lines that share an end meet there; past their first and last
      // stretch they should be apart.
      let inner = (pts: Spot[]) => pts.slice(4, -4)
      let near = inner(ap).some(([x, y]) =>
        inner(bp).some(([u, v]) => Math.hypot(x - u, y - v) < 6)
      )
      if (near) {
        knot(`${a.said} runs over ${b.said}`, a.l.key, b.l.key)
      }
    }
  }
  // Each line's name, as svg() writes it.
  for (let [i, { said, l, named }] of paths.entries()) {
    for (let n of nodes) {
      if (!asked(l.key, n.eid)) continue
      let [x0, y0, x1, y1] = named()
      let [w, h] = size.get(n.eid)!
      if (x0 < n.x + w && x1 > n.x - w && y0 < n.y + h && y1 > n.y - h) {
        knot(`the name of ${said} sits on ${n.label}`, l.key, n.eid)
      }
    }
    for (let o of paths.slice(i + 1)) {
      if (!asked(l.key, o.l.key)) continue
      let [x0, y0, x1, y1] = named(), [u0, v0, u1, v1] = o.named()
      if (x0 < u1 && u0 < x1 && y0 < v1 && v0 < y1) {
        knot(
          `the names of ${said} and ${o.said} sit on each other`,
          l.key,
          o.l.key,
        )
      }
    }
  }
  return out
}
