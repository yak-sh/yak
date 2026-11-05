// How a pen draws a layout in: each stage's shapes and lines one after
// another, each shape followed by the lines that reach it, so a reader who is
// part way through a stage sees part of it drawn and the pen where the next
// stroke is going. Pure: a layout and how far each stage has come in, how far
// each item is drawn and where the pen is out.
import type { Layout, Link, Node } from './layout.ts'
import { along, type Curve, curve, on } from './shape.ts'

/**
 * The curve each line is drawn along, by its key: from the rim of one shape
 * to the rim of the other, bent as far as its `bend`.
 *
 * ```ts
 * import { curves, layout } from '@yaks/diagram'
 * import { equal } from '@yaks/testing'
 *
 * let a = { entity: { eid: '0a' }, doc: { title: 'Dune' } }
 * let b = { entity: { eid: '0b' }, review: { of: '0a' } }
 * equal([...curves(layout([a, b])).keys()], ['0b>review.of>0a'])
 * ```
 */
export let curves = (layout: Layout): Map<string, Curve> => {
  let at = new Map(layout.nodes.map((d) => [d.eid, d]))
  return new Map(
    layout.links.map((l) => [
      l.key,
      curve(at.get(l.from)!, at.get(l.to)!, l.bend),
    ]),
  )
}

/** A shape or a line, by the key a drawing marks it with: a node's eid or a
 * link's key. */
export type Item = Node | Link

export let keyOf = (item: Item): string => 'key' in item ? item.key : item.eid

/**
 * The order a pen draws a layout's items in: stage by stage, and within a
 * stage each shape in the order it joined, then the lines that now have both
 * ends drawn.
 */
export let strokes = (layout: Layout): Item[][] => {
  let stages = [
    ...new Set([...layout.nodes, ...layout.links].map((x) => x.stage)),
  ].sort((a, b) => a - b)
  let drawn = new Set<string>()
  let stage = (s: number) => {
    let out: Item[] = []
    let lines = layout.links.filter((l) => l.stage == s)
      .sort((a, b) => a.order - b.order)
    let ready = () => {
      for (let l of lines) {
        if (out.includes(l) || !drawn.has(l.from) || !drawn.has(l.to)) continue
        out.push(l)
      }
    }
    // What earlier stages drew counts as drawn already.
    for (let n of layout.nodes) if (n.stage < s) drawn.add(n.eid)
    ready()
    for (
      let n of layout.nodes.filter((n) => n.stage == s)
        .sort((a, b) => a.order - b.order)
    ) {
      out.push(n)
      drawn.add(n.eid)
      ready()
    }
    for (let l of lines) if (!out.includes(l)) out.push(l)
    return out
  }
  return stages.map(stage)
}

/**
 * How far each item is drawn, 0 to 1, by its key, when each stage has come
 * `reached(stage)` of the way in (0 to 1). A stage's items share its way in:
 * the first is drawn while the stage is barely reached and the last only
 * once it nearly is.
 *
 * ```ts
 * import { layout, progress } from '@yaks/diagram'
 * import { equal } from '@yaks/testing'
 *
 * let a = { entity: { eid: '0a' }, doc: { title: 'Dune' } }
 * let drawn = layout([a], { stage: 1 })
 * equal(progress(drawn, () => 0).get('0a'), 0)
 * equal(progress(drawn, () => 1).get('0a'), 1)
 * ```
 */
export let progress = (
  layout: Layout,
  reached: (stage: number) => number,
): Map<string, number> => {
  let out = new Map<string, number>()
  for (let items of strokes(layout)) {
    let p = Math.max(0, Math.min(1, reached(items[0].stage)))
    items.forEach((x, i) =>
      out.set(keyOf(x), Math.max(0, Math.min(1, p * items.length * 1.15 - i)))
    )
  }
  return out
}

/** Where the pen is: on the item it is drawing, at that item's stage. */
export type Tip = { key: string; stage: number; x: number; y: number }

/**
 * The pen's tip: on the latest item still being drawn, as far along its
 * outline or line as it is drawn; none when nothing is part drawn.
 */
export let tip = (
  layout: Layout,
  drawn: Map<string, number>,
): Tip | undefined => {
  let lines = curves(layout)
  let busy = strokes(layout).flat()
    .filter((x) => {
      let t = drawn.get(keyOf(x)) ?? 0
      return t > 0 && t < 1
    }).at(-1)
  if (!busy) return
  let key = keyOf(busy), t = drawn.get(key)!
  let [x, y] = 'key' in busy
    ? on(lines.get(key)!, t)
    : along(busy.shape, !!busy.state, t).map((v, i) =>
      v + (i ? busy.y : busy.x)
    ) as [number, number]
  return { key, stage: busy.stage, x, y }
}
