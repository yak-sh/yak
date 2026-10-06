/** Where a trace's work went on one measure, as nested bars: each bar is a
 * place in the code, as wide as the work done there and in what it called,
 * its callees under it. Siblings that ran the same code are one bar
 * (./readings.ts `merge`). Widths add up within a parent, not along time:
 * a Worker's clock may not have moved, and rows have no time at all. Drawn
 * in SVG with the theme's hues, so it needs no sheet; each bar is a viewport
 * of its own, so its label is cut at its edge at any width. A terminal reads
 * the span table beside it instead.
 * @module
 */
import { h, type JSX } from 'preact'
import { amount, hue, type Merged, noun, said } from './readings.ts'

let ROW = 22

/** Bars for `roots` on `axis`, scaled so `extent` fills the width. */
export let Flamegraph = (
  { roots, axis, extent, pick }: {
    roots: Merged[]
    axis: string
    extent?: number
    /** what a press on a bar does, given the keys of the places down to it */
    pick?: (path: string[]) => void
  },
): JSX.Element | null => {
  let scale = extent ?? roots.reduce((a, r) => a + (r.total[axis] ?? 0), 0)
  if (!scale) return null
  let bars: JSX.Element[] = [], depth = 0
  let place = (ns: Merged[], level: number, from: number, path: string[]) => {
    let x = from
    for (let n of ns) {
      let v = n.total[axis] ?? 0
      if (v <= 0) continue
      let w = v / scale * 100, at = [...path, n.key]
      let label = `${said(n)}${n.spans.length > 1 ? ` ×${n.spans.length}` : ''}`
      let tone = n.error ? 'var(--negative)' : `var(--hue-${hue(n.op)})`
      depth = Math.max(depth, level + 1)
      bars.push(h(
        'g',
        {
          key: at.join('\n'),
          onClick: pick && (() => pick(at)),
          style: pick ? { cursor: 'pointer' } : undefined,
        },
        h(
          'svg',
          { x: `${x}%`, y: level * ROW, width: `${w}%`, height: ROW - 2 },
          h(
            'title',
            {},
            `${label}${n.plugin ? ` · ${n.plugin}` : ''}: ${amount(axis, v)}`,
          ),
          h('rect', {
            width: '100%',
            height: '100%',
            rx: 3,
            fill: `color-mix(in srgb, ${tone} 40%, var(--surface))`,
            stroke: tone,
            'stroke-width': 1,
          }),
          w >= 5
            ? h(
              'text',
              { x: 6, y: 15, fill: 'var(--text)', 'font-size': 12 },
              label,
            )
            : null,
        ),
      ))
      place(n.children, level + 1, x, at)
      x += w
    }
  }
  place(roots, 0, 0, [])
  return h(
    'svg',
    {
      width: '100%',
      height: depth * ROW,
      role: 'img',
      'aria-label': `Where the ${noun(axis)} went`,
      style: { display: 'block' },
    },
    bars,
  )
}
