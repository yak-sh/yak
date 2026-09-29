/**
 * `Inspect.History`: what was written, when and by whom, newest first, read
 * off the journal as `_change` rows (@yaks/journal), each in the transaction
 * (`_tx`) that wrote it. An entity's history is the changes aimed at it; a
 * component's is every write of it, anywhere.
 *
 * The changes arrive whole, and beside them the transactions that made them
 * and the components they wrote, each asked for by its reverse hop
 * (`._tx&._changes_tx._change.target=…`), so every host holds them as
 * entities of their own.
 *
 * @module
 */

import { type ComponentChildren, h, type VNode } from 'preact'
import { parse, type Query } from '@yaks/query'
import { Rows, Timeline } from '@yaks/ui'
import type { Bundle, Io, Props, View } from './host.ts'
import { section } from './page.ts'
import { comp, face, line, str } from './read.ts'
import { more, rows, waiting } from './rows.ts'
import { chip } from './Tile.ts'

/** How many changes a history shows. */
export let CHANGES = 40

// A history's asks, for the changes one `_change` column test picks
// (`target=<eid>`): the changes, the transactions that made them, the
// components they wrote, and how many there are.
let asks = (where: string) => ({
  rows: `${changes(where)}&.order=-_change.tx&.limit=${CHANGES}`,
  txs: `._tx&._changes_tx._change.${where}&.order=-_tx.seq&.limit=${CHANGES}`,
  comps: `._comp&._changes_comp._change.${where}`,
  total: `${changes(where)}&.count`,
})

/** The changes one `_change` column test picks, as a query. */
export let changes = (where: string): string => `._change&._change.${where}`

/** A component's name, by its `_comp` entity's eid. */
export let compName = (io: Io, eid: string): string =>
  str(io.get(eid), '_comp', 'name') || io.name(eid)

/** What one change wrote: the value, or that the component went. */
export let wrote = (b: Bundle): string => {
  let v = comp(b, '_change').value
  return v == null ? 'removed' : line(face(v), 160)
}

// The changes, one moment per transaction, each saying what it wrote: `what`
// draws one change.
let moments = (
  io: Io,
  changes: Bundle[],
  what: (b: Bundle) => ComponentChildren,
): VNode[] =>
  [...Map.groupBy(changes, (b) => str(b, '_change', 'tx'))].map(
    ([tx, cs]) => {
      let t = comp(io.get(tx), '_tx')
      let who = typeof t.by == 'string' ? t.by : ''
      let via = typeof t.via == 'string' && t.via != who ? t.via : ''
      return h(
        Timeline.Item,
        { key: tx },
        h(
          Timeline.When,
          {},
          h(
            'a',
            { href: io.link(tx) },
            t.at ? io.when(String(t.at)) : `#${t.seq ?? '…'}`,
          ),
        ),
        ' ',
        h(Timeline.Who, {}, who ? io.name(who) : ''),
        via ? ` via ${io.name(via)}` : '',
        cs.map((b) => h(Timeline.What, { key: b.entity.eid }, what(b))),
      )
    },
  )

/** What a history says about itself. */
export type Story = {
  view: string
  match: Query | true
  title: string
  /** open until folded (the default), or folded until opened */
  open?: boolean
  /** the changes it tells, as a test on one `_change` column */
  where: (e: Bundle) => string
  /** one change, drawn */
  what: (io: Io, b: Bundle, e: Bundle) => ComponentChildren
}

/** A history, as a section of a page. */
export let history = (s: Story): View =>
  section({
    view: s.view,
    match: s.match,
    title: s.title,
    open: s.open,
    asks: (e) => asks(s.where(e)),
    count: ({ got }) => got.total?.count,
    Body: ({ e, io, got }: Props) => {
      // Newest first, as asked: a live answer adds a change at its end.
      let all = rows(got.rows).toSorted((a, b) =>
        str(b, '_change', 'tx').localeCompare(str(a, '_change', 'tx'))
      )
      return waiting(got.rows) ??
        h(
          'div',
          {},
          h(Timeline, {}, moments(io, all, (b) => s.what(io, b, e))),
          all.length
            ? more(
              io,
              (got.total?.count ?? all.length) - all.length,
              changes(s.where(e)),
            )
            : h(Rows.More, {}, 'none'),
        )
    },
  })

/** A change's component, in its hue. */
export let which = (io: Io, b: Bundle): ComponentChildren =>
  chip(compName(io, str(b, '_change', 'comp')))

/** The entity a change was aimed at, linked. */
export let where = (io: Io, b: Bundle): ComponentChildren => {
  let target = str(b, '_change', 'target')
  return h('a', { href: io.link(target) }, io.name(target))
}

/** An entity's history, and a component's. */
export let histories: View[] = [
  history({
    view: 'Inspect.History',
    match: true,
    title: 'History',
    where: (e) => `target=${e.entity.eid}`,
    what: (io, b) => h('span', {}, which(io, b), ' ', wrote(b)),
  }),
  // Every write of one component reads the journal's changes by component,
  // which no index serves yet: asked when opened (README, Limits).
  history({
    view: 'Inspect.History',
    match: parse('._comp'),
    title: 'Writes',
    open: false,
    where: (e) => `comp=${e.entity.eid}`,
    what: (io, b) => h('span', {}, where(io, b), ' ', wrote(b)),
  }),
]
