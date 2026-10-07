/** A trace's places in the code as lines: each a name, indented under what
 * called it, and the work done there at the end of its line, in columns
 * that line up (./layout.ts), so a deep tree reads on a phone too.
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import type { Io } from '@yaks/inspect'
import { Button, Chip } from '@yaks/ui'
import { disclosed, disclosureAt, isOpen } from '@yaks/ux'
import {
  amount,
  comp,
  type Difference,
  figure,
  hue,
  labels,
  type Merged,
  metric,
  noun,
  said,
  walk,
} from './readings.ts'
import { figures, heading, line, list, name, number, quiet } from './layout.ts'
import { type Ran, tally } from './ran.ts'
import { statements } from './Statements.ts'

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

/** What a place opens to: the statements its spans ran, alike ones
 * together, and its spans, each a link to its page where they have one. */
let Opened = (
  { node, axis, io, pages }: {
    node: Merged
    axis: string
    io: Io
    pages: boolean
  },
): JSX.Element => {
  let ran = tally(
    node.spans.flatMap((b) => (comp(b, 'statements').ran ?? []) as Ran[]),
  )
  let spans = node.spans.toSorted((a, b) =>
    (metric(b, axis) ?? 0) - (metric(a, axis) ?? 0)
  )
  return h(
    'div',
    { style: { margin: '4px 0 10px' } },
    ran.length
      ? statements(h, ran)
      : h('p', { style: quiet }, 'No statement of its own was recorded.'),
    pages
      ? h(
        'p',
        { style: { ...quiet, margin: '6px var(--half-gap) 0' } },
        spans.length == 1
          ? 'Its span: '
          : `Its ${spans.length} spans, the most ${noun(axis)} first: `,
        spans.map((b, i) => [
          i ? ' · ' : '',
          h('a', {
            key: b.entity.eid,
            href: io.link(b.entity.eid),
            title: amount(axis, metric(b, axis)),
          }, io.id(b)),
        ]),
      )
      : null,
  )
}

/** Every place that did work on `axis`, in reading order, with the work
 * done there and in what it called, and its share of the whole; `id` names
 * each line by its place in the whole tree, so a press on a bar can find
 * it. The places that did none are counted. A press on a place opens it
 * under its line, kept open in the page's graph under `at`; `pages` says
 * whether its spans have pages to link to. */
export let Places = (
  { roots, axis, id, io, at, pages }: {
    roots: Merged[]
    axis: string
    id: (i: number) => string
    io: Io
    at: string
    pages: boolean
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
      some.map(({ node, depth, i, path }) => {
        let state = disclosureAt(`${at}:${path.join('\n')}`)
        let e = io.state(state) ?? { entity: { eid: state } }
        let open = isOpen(e), opened = `${id(i)}-opened`
        return [
          h(Line, {
            key: i,
            id: id(i),
            depth,
            label: h(
              Button,
              {
                type: 'button',
                mod: 'quiet',
                'aria-expanded': open,
                'aria-controls': opened,
                onClick: () => io.set([disclosed(e, !open)]),
              },
              open ? '▾ ' : '▸ ',
              h(Place, { n: node }),
            ),
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
          }),
          open
            ? h(
              'li',
              {
                key: opened,
                id: opened,
                style: { paddingLeft: `${depth * 1.1}em` },
              },
              h(Opened, { node, axis, io, pages }),
            )
            : null,
        ]
      }),
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
