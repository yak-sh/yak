/** A trace's places in the code as lines: each a name, indented under what
 * called it, and the work done there at the end of its line, in columns
 * that line up. A name wraps rather than being cut, and on a narrow screen
 * its figures drop below it, so a deep tree reads on a phone. Laid out in
 * place, as the page's sheet holds no rules of this package's own.
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import { Chip } from '@yaks/ui'
import {
  type Difference,
  figure,
  hue,
  labels,
  type Merged,
  noun,
  said,
  walk,
} from './readings.ts'

export let list = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  fontSize: '13px',
}
let line = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  columnGap: '1em',
  padding: '3px var(--half-gap)',
  borderBottom: '1px solid var(--border)',
}
let name = (depth: number) => ({
  flex: '1 1 14em',
  minWidth: 0,
  paddingLeft: `${depth * 1.1}em`,
  overflowWrap: 'anywhere',
})
let figures = {
  display: 'flex',
  alignItems: 'center',
  columnGap: '1em',
  marginLeft: 'auto',
}
// A fixed width, so the figures of every line stand in columns; a heading
// wider than its column wraps.
let number = {
  width: '6em',
  flex: 'none',
  textAlign: 'right',
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--number)',
}
let heading = {
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  color: 'var(--dim)',
}
let quiet = { color: 'var(--dim)' }

/** A place's name: the kind of work as a chip in its hue, which one, how
 * many spans ran it, and the plugin it belongs to. */
export let Place = ({ n }: { n: Merged }): JSX.Element =>
  h(
    'span',
    {},
    h(Chip, { mod: String(hue(n.op)) }, n.op),
    n.name && n.name != n.op ? ` ${n.name}` : null,
    n.spans.length > 1
      ? h('span', { style: quiet }, ` ×${n.spans.length}`)
      : null,
    n.error
      ? h('span', { style: { color: 'var(--negative)' } }, ' failed')
      : null,
    n.plugin ? h('span', { style: quiet }, ` · ${n.plugin}`) : null,
  )

/** One line: a label, indented `depth` steps, and figures in columns at
 * its end; the heading line names the columns. */
export let Line = (
  { depth = 0, label, cells, id, head }: {
    depth?: number
    label: ComponentChildren
    cells: ComponentChildren[]
    id?: string
    head?: boolean
  },
) =>
  h(
    'li',
    { id, style: head ? { ...line, ...heading } : line },
    h('span', { style: name(depth) }, label),
    h(
      'span',
      { style: figures },
      cells.map((c, i) =>
        h('span', {
          key: i,
          style: head ? { ...number, color: 'inherit' } : number,
        }, c)
      ),
    ),
  )

/** A share of a whole as a bar. */
export let Bar = (
  { of, whole, tone }: { of?: number; whole: number; tone: string },
) =>
  h(
    'svg',
    { width: 64, height: 8, 'aria-hidden': true, style: { flex: 'none' } },
    h('rect', { width: 64, height: 8, rx: 2, fill: 'var(--soft)' }),
    of && whole
      ? h('rect', {
        width: Math.max(1, of / whole * 64),
        height: 8,
        rx: 2,
        fill: tone,
      })
      : null,
  )

/** Every place that did work on `axis`, in reading order, with the work
 * done there and in what it called, and its share of the whole; `id` names
 * each line by its place in the whole tree, so a press on a bar can find
 * it. The places that did none are counted. */
export let Places = (
  { roots, axis, id }: {
    roots: Merged[]
    axis: string
    id: (i: number) => string
  },
): JSX.Element => {
  let whole = roots.reduce((a, r) => a + (r.total[axis] ?? 0), 0)
  let all = walk(roots).map((w, i) => ({ ...w, i }))
  let some = all.filter((w) => (w.node.total[axis] ?? 0) > 0)
  let none = all.length - some.length
  let note = (text: string) =>
    h('p', {
      style: { ...quiet, margin: '6px var(--half-gap)', fontSize: '13px' },
    }, text)
  if (!some.length) return note(`No place recorded any ${noun(axis)}.`)
  return h(
    'div',
    {},
    h(
      'ul',
      { style: list },
      h(Line, { head: true, label: 'place', cells: [labels[axis], 'share'] }),
      some.map(({ node, depth, i }) =>
        h(Line, {
          key: i,
          id: id(i),
          depth,
          label: h(Place, { n: node }),
          cells: [
            figure(axis, node.total[axis]),
            h(Bar, {
              of: node.total[axis],
              whole,
              tone: node.error
                ? 'var(--negative)'
                : `var(--hue-${hue(node.op)})`,
            }),
          ],
        })
      ),
    ),
    none
      ? note(
        `${none} more ${none == 1 ? 'place' : 'places'} recorded no ${
          noun(axis)
        }.`,
      )
      : null,
  )
}

/** Where two traces of a kind differ, place by place: what this one did
 * there, what the ordinary one did, and how much more. */
export let Gaps = (
  { gaps, axis }: { gaps: Difference[]; axis: string },
): JSX.Element =>
  h(
    'ul',
    { style: list },
    h(Line, {
      head: true,
      label: `where the ${noun(axis)} differs most`,
      cells: ['this', 'ordinary', 'more'],
    }),
    gaps.map((d, i) =>
      h(Line, {
        key: i,
        label: [
          d.up.length
            ? h('span', { style: quiet }, `${said(d.up.at(-1)!)} › `)
            : null,
          h(Place, { n: d.node }),
        ],
        cells: [
          figure(axis, d.mine),
          figure(axis, d.theirs),
          `${d.by > 0 ? '+' : '−'}${figure(axis, Math.abs(d.by))}`,
        ],
      })
    ),
  )
