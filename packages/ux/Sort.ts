/** A controlled table sorted by raw values, keeping each row's detail rows
 * together. Server-rendered tables use the same transitions through bindSort.
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { type Col, Table } from '@yaks/ui/parts'

/** Numbers include money and timestamps; null values follow known values. */
export type SortValue = string | number | null
/** One sortable item, which may draw several related table rows. */
export type SortRow = { values: SortValue[]; content: ComponentChildren }
/** The column and direction the reader chose. */
export type SortState = { column: number; direction: 'asc' | 'desc' }
/** The page entity for one owner's table. */
export let sortAt = (owner: string): string => derivedEid(`Sort|${owner}`)
/** The sort choice supplied by the table's owner. */
export let sortOf = (e?: Bundle): SortState | undefined =>
  e?.Sort as SortState | undefined
/** Pressing the same column reverses it; a new column starts ascending. */
export let sorted = (e: Bundle, column: number): Bundle => ({
  entity: e.entity,
  Sort: {
    column,
    direction: sortOf(e)?.column == column && sortOf(e)?.direction == 'asc'
      ? 'desc'
      : 'asc',
  },
})

let compared = (a: SortValue, b: SortValue) =>
  typeof a == 'number' && typeof b == 'number'
    ? a - b
    : String(a).localeCompare(String(b))
/** A stable copy ordered by values, with missing values last either way. */
export let sortRows = <T>(
  rows: T[],
  values: (row: T) => SortValue[],
  state?: SortState,
): T[] =>
  !state ? [...rows] : [...rows].sort((a, b) => {
    let x = values(a)[state.column] ?? null
    let y = values(b)[state.column] ?? null
    return x == null
      ? y == null ? 0 : 1
      : y == null
      ? -1
      : compared(x, y) * (state.direction == 'asc' ? 1 : -1)
  })

/** State, column labels, layout and items supplied by the table's owner. */
export type SortProps = {
  e: Bundle
  onChange: (b: Bundle) => void
  cols: Col[]
  heads: string[]
  rows: SortRow[]
}

/** A table whose column headers can be pressed by pointer or keyboard. */
export let Sort = (
  { e, onChange, cols, heads, rows }: SortProps,
): JSX.Element => {
  let state = sortOf(e)
  return h(
    Table,
    { cols, 'data-sort': e.entity.eid },
    h(
      Table.Head,
      null,
      h(
        Table.Row,
        null,
        heads.map((head, column) => {
          let dir = state?.column == column && state.direction
          return h(
            Table.Heading,
            {
              mod: [cols[column] == 'num' && 'num', 'sorts', dir],
              'aria-sort': dir
                ? dir == 'asc' ? 'ascending' : 'descending'
                : 'none',
            },
            h(Table.Sort, {
              type: 'button',
              'data-sort-column': column,
              onClick: () => onChange(sorted(e, column)),
            }, head),
          )
        }),
      ),
    ),
    sortRows(rows, (r) => r.values, state).map((r) =>
      h(Table.Body, { 'data-sort-values': JSON.stringify(r.values) }, r.content)
    ),
  )
}
