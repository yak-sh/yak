// A layout as SVG markup. Pure: the drawing is a string, styled only through
// classes and custom properties (diagram.css), so a page sets the colours.
// Each stroke has pathLength 1, so a stylesheet can draw it in with
// stroke-dashoffset the way a pen would; what joined in this layout carries
// `is-new` and `--i`, its place in the order it is drawn.
import { BOX, type Layout, type Link, type Node } from './layout.ts'

/** How a layout is drawn. */
export type SvgOptions = {
  /** The svg's class (default `Diagram`). */
  class?: string
  /** An accessible name for the drawing. */
  title?: string
}

let esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`,
  )
let n = (x: number) => +x.toFixed(1)

const BOXPATH = `M${-BOX.w},${-BOX.h}H${BOX.w}V${BOX.h}H${-BOX.w}Z`

// Where a line from a box's centre toward (dx, dy) leaves the box.
let rim = (dx: number, dy: number): [number, number] => {
  let t = Math.min(
    (BOX.w + 3) / (Math.abs(dx) || 1e-9),
    (BOX.h + 3) / (Math.abs(dy) || 1e-9),
  )
  return [dx * t, dy * t]
}

let fresh = (on: boolean, i: number) =>
  on ? [' is-new', ` style="--i:${i}"`] : ['', '']

let node = (d: Node, i: number) => {
  let [cls, style] = fresh(d.fresh, i)
  let x = -BOX.w + 9
  let comps = d.comps.join(' ')
  return `<g class="Diagram_Node${cls}" data-eid="${esc(d.eid)}" data-comps="${
    esc(comps)
  }" tabindex="0" transform="translate(${n(d.x)} ${n(d.y)})"${style}>` +
    `<path class="Diagram_Fill" d="${BOXPATH}"/>` +
    `<path class="Diagram_Stroke" pathLength="1" d="${BOXPATH}"/>` +
    `<text class="Diagram_Id" x="${x}" y="${-BOX.h + 14}">${
      esc(d.label)
    }</text>` +
    `<text class="Diagram_Title" x="${x}" y="4">${esc(d.title)}</text>` +
    `<text class="Diagram_Comps" x="${x}" y="${BOX.h - 8}">${
      esc(d.comps.join(' · '))
    }</text></g>`
}

let link = (l: Link, i: number, at: Map<string, Node>, bend: number) => {
  let a = at.get(l.from)!, b = at.get(l.to)!
  let dx = b.x - a.x, dy = b.y - a.y
  let [ox, oy] = rim(dx, dy), [ix, iy] = rim(-dx, -dy)
  let x0 = a.x + ox, y0 = a.y + oy, x1 = b.x + ix, y1 = b.y + iy
  let len = Math.hypot(x1 - x0, y1 - y0) || 1
  let nx = -(y1 - y0) / len, ny = (x1 - x0) / len
  let cx = (x0 + x1) / 2 + nx * bend, cy = (y0 + y1) / 2 + ny * bend
  // The curve's midpoint, where its name sits.
  let mx = .25 * x0 + .5 * cx + .25 * x1, my = .25 * y0 + .5 * cy + .25 * y1
  let [cls, style] = fresh(l.fresh, i)
  let kind = l.eid ? 'Diagram_Link-edge' : 'Diagram_Link-ref'
  return `<g class="Diagram_Link ${kind}${cls}" data-from="${
    esc(l.from)
  }" data-to="${esc(l.to)}" data-name="${esc(l.name)}"${
    l.eid ? ` data-eid="${esc(l.eid)}"` : ''
  }${style}>` +
    `<path class="Diagram_Line" pathLength="1" d="M${n(x0)},${n(y0)}Q${n(cx)},${
      n(cy)
    } ${n(x1)},${n(y1)}"/>` +
    `<text class="Diagram_Name" x="${n(mx)}" y="${n(my - 4)}">${
      esc(l.name)
    }</text></g>`
}

/**
 * Draw a layout as one `<svg>` element: lines under boxes, each box a group
 * with its id, title and components, each line named.
 *
 * ```ts
 * import { layout, svg } from '@yaks/diagram'
 * import { assert } from '@std/assert'
 *
 * let drawn = svg(layout([{ entity: { eid: '0a' }, doc: { title: 'Dune' } }]))
 * assert(drawn.includes('>Dune</text>'))
 * ```
 */
export let svg = (layout: Layout, opts: SvgOptions = {}): string => {
  let at = new Map(layout.nodes.map((d) => [d.eid, d]))
  // New strokes draw in the order they joined: boxes, then the lines to them.
  let order = [...layout.nodes, ...layout.links].filter((x) => x.fresh)
    .sort((a, b) => a.order - b.order)
  let index = new Map<object, number>(order.map((x, i) => [x, i]))
  let pairs = new Map<string, number>()
  let lines = layout.links.map((l) => {
    let pair = [l.from, l.to].sort().join('|')
    let k = pairs.get(pair) ?? 0
    pairs.set(pair, k + 1)
    let bend = k == 0 ? 0 : (k % 2 ? -1 : 1) * (24 + 14 * Math.floor(k / 2)) *
      (l.from < l.to ? 1 : -1)
    return link(l, index.get(l) ?? 0, at, bend)
  })
  let title = opts.title ? `<title>${esc(opts.title)}</title>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${
    esc(opts.class ?? 'Diagram')
  }" viewBox="0 0 ${n(layout.width)} ${n(layout.height)}" role="img">${title}` +
    `<g class="Diagram_Links">${lines.join('')}</g>` +
    `<g class="Diagram_Nodes">${
      layout.nodes.map((d) => node(d, index.get(d) ?? 0)).join('')
    }</g></svg>`
}
