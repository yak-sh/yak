/**
 * A table of things, the way every inspector page draws one: @yaks/ui's
 * `Table`, a column per heading and a row per thing. A press on a row opens
 * the entity it stands for (`io.go` to its `link`), unless the press was on
 * a link or a value inside it; the keyboard can rest on a row, for Enter to
 * open it (./main.ts). A press on a heading whose column can sort runs the
 * rows by it, then back the other way, then as they came.
 * A long table shows a page of rows at a time, with a `Pager` under it. How
 * the rows run and which page shows are the table's state in the page's own
 * graph (./state.ts `grid`), so a page shown again shows as it was left.
 *
 * A table paged by the graph asks for one page at a time (`paged`), and the
 * graph sorts it; one whose rows are all in hand (a tally, a component's
 * properties) pages them itself (`local`), and sorts them by a column's
 * `value` (`run`).
 *
 * @module
 */

import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import { conjoin } from '@yaks/query'
import { Pager, Table } from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { count } from './read.ts'
import { none } from './rows.ts'
import { grid, turned } from './state.ts'

/** How many rows a page of a table holds. */
export let SIZE = 50

/** One column: its heading, what its cells hold, and what it sorts by. */
export type Column = {
  name: string
  /** the property the graph runs its rows by when its heading is pressed */
  sort?: string
  /** what a table holding every row runs them by when its heading is
   * pressed: a number, or text */
  value?: (b: Bundle) => number | string
  mod?: 'num' | 'key' | 'prose'
  cell: (b: Bundle) => ComponentChildren
}

// What a column sorts by in a table's state: the property the graph runs by,
// or, where the table holds its rows, the column's name.
let sorted = (c: Column) => c.sort ?? (c.value ? c.name : undefined)

/**
 * Rows a table holds, run by the column its order names (`-` before it when
 * they run down), or as they came.
 *
 * ```ts
 * import { type Column, run } from './grid.ts'
 * let rows = [2, 3, 1].map((n) => ({ entity: { eid: `${n}` } }))
 * let cols: Column[] = [
 *   { name: 'n', value: (b) => Number(b.entity.eid), cell: () => '' },
 * ]
 * run(rows, cols, '-n').map((b) => b.entity.eid) // ['3', '2', '1']
 * run(rows, cols, null).map((b) => b.entity.eid) // ['2', '3', '1']
 * ```
 */
export let run = (
  rows: Bundle[],
  columns: Column[],
  order?: string | null,
): Bundle[] => {
  let down = !!order?.startsWith('-')
  let c = columns.find((c) => c.value && c.name == order?.replace(/^-/, ''))
  if (!c?.value) return rows
  let v = c.value
  return rows.toSorted((a, b) => {
    let [x, y] = [v(a), v(b)]
    let d = typeof x == 'number' && typeof y == 'number'
      ? x - y
      : String(x).localeCompare(String(y))
    return down ? -d : d
  })
}

/**
 * The line for the page of `base`'s rows the table `id` shows: run by its
 * order (or `order`, when the table names none), after the last row of the
 * page before, `size` of them.
 *
 * ```ts
 * import { paged } from './grid.ts'
 * let io = { state: () => ({ entity: { eid: 't' }, table: { order: '-task.status', after: ['e9'] } }) }
 * paged(io, 't', '.task') // '.task&.order=-task.status&.after=e9&.limit=50'
 * ```
 */
export let paged = (
  io: Pick<Io, 'state'>,
  id: string,
  base: string,
  { order, size = SIZE }: { order?: string; size?: number } = {},
): string => {
  let g = grid(io, id)
  let by = g.order || order
  return conjoin(
    base,
    by ? `.order=${by}` : '',
    g.after?.length ? `.after=${g.after.at(-1)}` : '',
    `.limit=${size}`,
  )
}

/** Whether a press landed on something of its own inside the row: a link, a
 * control, a value that can be changed (@yaks/ux). */
let own = (target: unknown): boolean => {
  for (
    let n = target as {
      localName?: string
      className?: string
      parentNode?: unknown
    } | null;
    n && !/\bTable_Row\b/.test(n.className ?? '');
    n = n.parentNode as typeof n
  ) {
    if (['a', 'button', 'input', 'select', 'textarea'].includes(n.localName!)) {
      return true
    }
    if (/\b(Prop-live|Edit)\b/.test(n.className ?? '')) return true
  }
  return false
}

/** What a grid is drawn with. */
export type GridProps = {
  io: Io
  /** the table's state entity in the page's own graph */
  id: string
  columns: Column[]
  /** the page of rows the graph answered, or every row when `local` */
  rows: Bundle[]
  /** how many rows there are in all, when that is known */
  total?: number
  /** every row is in hand: the table pages them itself */
  local?: boolean
  size?: number
  /** the entity a press on a row opens (its own, unless this says
   * another); undefined opens nothing */
  pick?: ((b: Bundle) => string | undefined) | false
}

/** What a pager is drawn with: the table it pages, how many rows this page
 * shows and the last of them, how many a page holds, how many there are in
 * all when that is known, and what its steps say. */
export type PagingProps = {
  io: Io
  id: string
  shown: number
  last?: string
  size: number
  total?: number
  steps?: [back: string, next: string]
}

/** Where a page of rows sits, and a step to the page either side of it: the
 * way back is the last row of each page before, kept in the table's state.
 * Nothing, for a table that fits on one page. */
export let Paging = (p: PagingProps): JSX.Element | null => {
  let { io, id, shown, size, total } = p
  let after = grid(io, id).after ?? []
  let page = after.length
  let to = page * size + shown
  let more = total != null ? to < total : shown == size
  let [back, next] = p.steps ?? ['‹ back', 'next ›']
  let step = (d: number) =>
    io.set(turned(id, {
      after: d < 0 ? after.slice(0, -1) : [...after, p.last ?? String(page)],
    }))
  return page || more
    ? h(
      Pager,
      {},
      h(
        Pager.Span,
        {},
        `${count(page * size + 1)}–${count(to)}`,
        total != null ? ` of ${count(total)}` : '',
      ),
      h(Pager.Step, {
        type: 'button',
        disabled: !page,
        onClick: () => step(-1),
      }, back),
      h(Pager.Step, {
        type: 'button',
        disabled: !more,
        onClick: () => step(1),
      }, next),
    )
    : null
}

// Which way a column runs: its heading's variant.
let way = (order: string | null | undefined, c: Column) =>
  !sorted(c)
    ? undefined
    : order == sorted(c)
    ? 'asc'
    : order == `-${sorted(c)}`
    ? 'desc'
    : undefined

/** A table of things, paged, its rows opened and its columns sorted. */
export let Grid = (p: GridProps): JSX.Element => {
  let { io, id, columns, local } = p
  let size = p.size ?? SIZE
  let g = grid(io, id)
  let rows = local ? run(p.rows, columns, g.order) : p.rows
  let after = g.after ?? []
  let page = after.length
  let shown = local ? rows.slice(page * size, (page + 1) * size) : rows
  let pick = p.pick === false
    ? () => undefined
    : p.pick ?? ((b: Bundle) => b.entity.eid)
  let sort = (c: Column) => {
    let by = sorted(c)!
    let next = g.order == by ? `-${by}` : g.order == `-${by}` ? null : by
    io.set(turned(id, { order: next, after: [] }))
  }
  if (!rows.length && !page) return none()
  return h(
    Fragment,
    null,
    h(
      Table,
      { 'data-table': id, cols: columns.map((c) => c.mod) },
      h(
        Table.Head,
        {},
        h(
          Table.Row,
          {},
          columns.map((c) =>
            h(Table.Heading, {
              key: c.name,
              mod: [
                sorted(c) && 'sorts',
                way(g.order, c),
                c.mod == 'num' && 'num',
              ],
              onClick: sorted(c) ? () => sort(c) : undefined,
            }, c.name)
          ),
        ),
      ),
      h(
        Table.Body,
        {},
        shown.map((b) => {
          let at = pick(b)
          return h(
            Table.Row,
            {
              key: b.entity.eid,
              mod: at && 'picks',
              'data-pick': at,
              tabIndex: at ? -1 : undefined,
              onClick: at
                ? (ev: { target: unknown }) =>
                  own(ev.target) || io.go(io.link(at))
                : undefined,
            },
            columns.map((c) =>
              h(Table.Cell, { key: c.name, mod: c.mod }, c.cell(b))
            ),
          )
        }),
      ),
    ),
    h(Paging, {
      io,
      id,
      shown: shown.length,
      last: shown.at(-1)?.entity.eid,
      size,
      total: local ? rows.length : p.total,
    }),
  )
}
