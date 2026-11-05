// A pen's progress put on a drawing in a page: each item drawn as far as it
// has come, hidden before it starts and finished once it is drawn, and the
// pen where the latest stroke is. The one place the diagram touches a
// document.
import type { Layout } from './layout.ts'
import { type Tip, tip } from './pen.ts'

/** The part of a DOM element ink() uses. */
export type Inked = {
  querySelectorAll(selector: string): Iterable<Inked>
  querySelector(selector: string): Inked | null
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  classList: { add(c: string): void; toggle(c: string, on: boolean): void }
}

/**
 * Draw each item of `svg` (a drawing of `layout`) as far as `drawn` says,
 * by its `data-key`, and put the pen at the tip. An item `drawn` leaves out is
 * drawn whole. Returns the tip, if a stroke is part drawn.
 *
 * ```ts
 * import { ink, layout, progress, svg } from '@yaks/diagram'
 * import { parseHTML } from 'linkedom'
 * import { equal } from '@yaks/testing'
 *
 * let drawn = layout([{ entity: { eid: '0a' }, doc: { title: 'Dune' } }])
 * let { document } = parseHTML(`<div>${svg(drawn)}</div>`)
 * let sheet = document.querySelector('svg')!
 * equal(ink(sheet as never, drawn, progress(drawn, () => .5))?.key, '0a')
 * equal(sheet.querySelector('[data-key="0a"]')!.classList.contains('is-drawing'), true)
 * ```
 */
export let ink = (
  svg: Inked,
  layout: Layout,
  drawn: Map<string, number>,
): Tip | undefined => {
  svg.classList.add('is-inked')
  for (let g of svg.querySelectorAll('[data-key]')) {
    let t = drawn.get(g.getAttribute('data-key') ?? '') ?? 1
    g.classList.toggle('is-gone', t <= 0)
    g.classList.toggle('is-drawing', t > 0 && t < 1)
    g.classList.toggle('is-drawn', t >= 1)
    for (let s of g.querySelectorAll('.Diagram_Stroke, .Diagram_Line')) {
      s.setAttribute('style', `stroke-dashoffset:${+(1 - t).toFixed(4)}`)
    }
  }
  let at = tip(layout, drawn)
  let pen = svg.querySelector('.Diagram_Pen')
  if (pen) {
    pen.setAttribute('opacity', at ? '1' : '0')
    if (at) {
      pen.setAttribute(
        'transform',
        `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`,
      )
    }
  }
  return at
}
