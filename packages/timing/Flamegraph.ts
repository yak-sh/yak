/** A trace's measured spans, laid out on a common axis. Time that a Worker
 * did not measure cannot be reconstructed; row width is an inclusive count,
 * not a claim about the start time of each SQL read. */
import { h } from 'preact'
import type { Bundle } from '@yaks/graph'
import {
  type Branch,
  branches,
  comp,
  format,
  labels,
  metric,
  number,
  str,
} from './readings.ts'
export let Flamegraph = (
  { rows, axis, extent: scale }: {
    rows: Bundle[]
    axis: string
    extent?: number
  },
) => {
  let roots = branches(rows),
    flat: { node: Branch; depth: number; start: number }[] = []
  let visit = (ns: Branch[], depth: number, start: number) => {
    let offset = start
    for (let node of ns) {
      let at = axis == 'elapsed'
        ? number(comp(node.row, 'elapsed').start) ?? 0
        : offset
      flat.push({ node, depth, start: at })
      visit(node.children, depth + 1, at)
      offset += metric(node.row, axis) ?? 0
    }
  }
  visit(roots, 0, 0)
  let extent = Math.max(
    scale ?? 0,
    ...flat.map((n) => n.start + (metric(n.node.row, axis) ?? 0)),
  )
  if (!extent || !rows.some((row) => (metric(row, axis) ?? 0) > 0)) {
    return h(
      'p',
      { class: 'Section_Sub' },
      `No positive ${
        labels[axis]
      } recorded. A zero clock is not evidence of cheap work; choose a row metric.`,
    )
  }
  let width = 960,
    line = 30,
    height = (Math.max(0, ...flat.map((n) => n.depth)) + 1) * line
  return h(
    'figure',
    { style: { margin: '0', overflowX: 'auto' } },
    h(
      'svg',
      {
        viewBox: `0 0 ${width} ${height}`,
        width: '100%',
        height,
        role: 'img',
        'aria-label': `Flamegraph by ${labels[axis]}`,
      },
      flat.map(({ node, depth, start }) => {
        let row = node.row, code = comp(row, 'span'), n = metric(row, axis) ?? 0
        let x = start / extent * width, w = n / extent * width
        let label = `${str(code.op)} · ${str(code.name)}${
          code.plugin ? ' · ' + str(code.plugin) : ''
        }`
        let detail = `${label}: ${format(n)} ${labels[axis]}${
          node.orphan ? ' · missing or cyclic parent' : ''
        }`
        return h(
          'a',
          {
            key: row.entity.eid,
            href: `#span-${row.entity.eid}`,
            onClick: (ev: MouseEvent) => {
              ev.preventDefault()
              ev.stopPropagation()
              globalThis.document?.getElementById?.(`span-${row.entity.eid}`)
                ?.scrollIntoView?.(
                  { block: 'nearest' },
                )
            },
          },
          h('title', {}, detail),
          h('rect', {
            x,
            y: depth * line,
            width: Math.max(w, 1),
            height: line - 2,
            rx: 2,
            fill: code.outcome == 'error' ? 'var(--negative)' : 'var(--accent)',
            opacity: Math.max(.35, .85 - depth * .08),
            stroke: 'var(--surface)',
          }),
          w > 65
            ? h('text', {
              x: x + 5,
              y: depth * line + 19,
              fill: 'var(--bg)',
              fontSize: 12,
            }, label.slice(0, Math.floor(w / 7)))
            : null,
        )
      }),
    ),
    h(
      'figcaption',
      { class: 'Section_Sub' },
      axis == 'elapsed'
        ? 'Start and width are recorded milliseconds. Parent and child time overlap.'
        : `Width is inclusive ${
          labels[axis]
        }; siblings are laid out in recorded order, not a time axis. Do not add parent and child counts.`,
    ),
    h(
      'p',
      { class: 'Section_Sub' },
      `Axis: 0–${format(extent)} ${
        labels[axis]
      }. Select a bar to jump to its span and exact measurements.`,
    ),
  )
}
