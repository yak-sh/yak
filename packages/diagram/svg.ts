// A layout as SVG markup. Pure: the drawing is a string, styled only through
// classes and custom properties (diagram.css), so a page sets the colours.
// Each stroke has pathLength 1, so a stylesheet can draw it in with
// stroke-dashoffset the way a pen would; what joined in this layout carries
// `is-new` and `--i`, its place in the order it is drawn.
import { cut, type Layout, type Link, type Node } from './layout.ts'
import { curves } from './pen.ts'
import { type Curve, half, outline, radius, tag } from './shape.ts'

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

let fresh = (on: boolean, i: number) =>
  on ? [' is-new', ` style="--i:${i}"`] : ['', '']

let text = (cls: string, x: number, y: number, s: string, anchor = '') =>
  `<text class="${cls}" x="${n(x)}" y="${n(y)}"${
    anchor ? ` text-anchor="${anchor}"` : ''
  }>${esc(s)}</text>`

// What a shape says: a round one its id inside and its title and components
// beneath; any other its id, title and components inside, and a task's state
// with a mark at its top right.
let words = (d: Node) => {
  let comps = d.comps.join(' · ')
  if (d.shape == 'round' || d.shape == 'hex') {
    let r = radius(d.shape)
    return text('Diagram_Id', 0, 4, d.label, 'middle') +
      text('Diagram_Title', 0, r + 15, cut(d.title, 18), 'middle') +
      text('Diagram_Comps', 0, r + 27, cut(comps, 22), 'middle')
  }
  let [w, h] = half(d.shape, !!d.state)
  let room = Math.floor((2 * w - 18) / 6.6)
  let x = -w + 9
  return text('Diagram_Id', x, -h + 15, d.label) +
    text('Diagram_Title', x, 4, cut(d.title, room)) +
    text(
      'Diagram_Comps',
      x,
      h - 8,
      cut(comps, Math.floor((2 * w - 18) / 5.4)),
    ) +
    (d.state
      ? `<circle class="Diagram_Mark" cx="${w - 11}" cy="${
        -h + 11
      }" r="3.6"/>` +
        text('Diagram_State', w - 19, -h + 14.5, d.state, 'end')
      : '')
}

let node = (d: Node, i: number) => {
  let [cls, style] = fresh(d.fresh, i)
  let path = outline(d.shape, !!d.state)
  let state = d.state ? ` is-${esc(d.state)}` : ''
  return `<g class="Diagram_Node Diagram_Node-${d.shape}${state}${cls}" data-key="${
    esc(d.eid)
  }" data-eid="${esc(d.eid)}" data-comps="${
    esc(d.comps.join(' '))
  }" tabindex="0" transform="translate(${n(d.x)} ${n(d.y)})"${style}>` +
    `<path class="Diagram_Fill" d="${path}"/>` +
    `<path class="Diagram_Stroke" pathLength="1" d="${path}"/>` +
    words(d) + '</g>'
}

let link = (l: Link, i: number, c: Curve) => {
  let { x0, y0, cx, cy, x1, y1 } = c
  let [cls, style] = fresh(l.fresh, i)
  let kind = l.eid ? 'Diagram_Link-edge' : 'Diagram_Link-ref'
  let head = l.eid ? 'Diagram-tip' : 'Diagram-tip-ref'
  let line = `<path class="Diagram_Line" pathLength="1" d="M${n(x0)},${n(y0)}Q${
    n(cx)
  },${n(cy)} ${n(x1)},${n(y1)}" marker-end="url(#${head})"/>`
  // An edge is an entity: a diamond on its line, its relation and its id
  // beside it.
  let { x, y, name, sub } = tag(c, l.mid, l.name, l.eid && (l.label ?? ''))
  let named = l.eid
    ? `<path class="Diagram_Dia" d="M${n(x)},${n(y - 7)}L${n(x + 7)},${n(y)}L${
      n(x)
    },${n(y + 7)}L${n(x - 7)},${n(y)}Z"/>` +
      text('Diagram_Name', name[0], name[1], l.name, name[2]) +
      (l.label ? text('Diagram_Sub', sub[0], sub[1], l.label, sub[2]) : '')
    : text('Diagram_Name', name[0], name[1], l.name, name[2])
  return `<g class="Diagram_Link ${kind}${cls}" data-key="${
    esc(l.key)
  }" data-from="${esc(l.from)}" data-to="${esc(l.to)}" data-name="${
    esc(l.name)
  }"${l.eid ? ` data-eid="${esc(l.eid)}"` : ''}${style}>` + line + named +
    '</g>'
}

// Arrowheads for both kinds of line, and the pen: a tip with a halo and
// crosshairs, hidden until a page puts it where a stroke is being drawn.
const DEFS = '<defs>' +
  '<marker id="Diagram-tip" viewBox="0 0 8 8" refX="7.2" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto"><path class="Diagram_Head" d="M0 0.6L8 4L0 7.4Z"/></marker>' +
  '<marker id="Diagram-tip-ref" viewBox="0 0 8 8" refX="7.2" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto"><path class="Diagram_Head Diagram_Head-ref" d="M0 0.8L8 4L0 7.2Z"/></marker>' +
  '</defs>'
const PEN = '<g class="Diagram_Pen" opacity="0">' +
  '<circle class="Diagram_Halo" r="9"/>' +
  '<path class="Diagram_Hair" d="M-14 0H-5M5 0H14M0 -14V-5M0 5V14"/>' +
  '<circle class="Diagram_Tip" r="2.8"/></g>'

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
  let lines = curves(layout)
  // New strokes draw in the order they joined: shapes, then the lines to them.
  let order = [...layout.nodes, ...layout.links].filter((x) => x.fresh)
    .sort((a, b) => a.order - b.order)
  let index = new Map<object, number>(order.map((x, i) => [x, i]))
  let title = opts.title ? `<title>${esc(opts.title)}</title>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${
    esc(opts.class ?? 'Diagram')
  }" viewBox="0 0 ${n(layout.width)} ${n(layout.height)}" role="img">${title}` +
    DEFS +
    `<g class="Diagram_Links">${
      layout.links.map((l) => link(l, index.get(l) ?? 0, lines.get(l.key)!))
        .join('')
    }</g>` +
    `<g class="Diagram_Nodes">${
      layout.nodes.map((d) => node(d, index.get(d) ?? 0)).join('')
    }</g>${PEN}</svg>`
}
