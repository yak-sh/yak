/**
 * Things in rows under column headings: `Table.Head` holds a `Table.Row` of
 * `Table.Heading`s, and `Table.Body` a `Table.Row` of `Table.Cell`s for each
 * thing. The table is a grid, not an html table, so a cell keeps to one line
 * and cuts short with an ellipsis, as a table cell cannot; each row is a
 * subgrid of it, so the cells line up. `cols` says what each column holds,
 * which is how wide it runs: a variant its cells wear, or nothing for text.
 *
 * A row a press picks wears `Row-picks`, and is raised while the keyboard
 * is on it (`Row-focus` shows that); `Row-hover` is the one under the
 * pointer; a row that tells of the rest rather than naming a thing (what is
 * too small to list) is `Row-quiet`, its words muted. A heading a press sorts
 * by wears `Heading-sorts`, and
 * `Heading-asc` or `Heading-desc` once the rows run by it, which its arrow
 * says; `Heading-num` heads a column of numbers. A cell
 * is `Cell-num` for a number, set right and never cut; `Cell-key` for the
 * name of what its row holds, in a table of pairs; and `Cell-prose` for text
 * that wraps rather than cutting short. What a press on a row or a heading
 * does is the caller's. The table's `style` is its own: it carries the
 * columns.
 *
 * A table can be a tree, its rows holding rows. A row that holds some starts
 * its first cell with a `Toggle`, a press showing them under it (`Toggle-open`
 * while they show), and a row sits an `Indent` deep for each row it is under;
 * an `Indent` is as wide as a `Toggle`, and stands for one in a row that holds
 * none, so the words of every row line up under its parent's.
 *
 * Each part says what it is to a reader of the page by its role (`table`,
 * `row`, `cell`, …), as an html table's elements would, and a terminal lays
 * it out as the grid it is (@yaks/tui's `grid`).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Value } from './Value.ts'

/** What a column holds: the variant its cells wear (`num`, `key`,
 * `prose`), or nothing for text. */
export type Col = string | false | null | undefined

/** What a table is drawn with: what each of its columns holds, and anything
 * a part takes. */
export type TableProps = Props & { cols?: Col[] }

let Base = block('div', 'Table', {
  Head: 'div',
  Body: 'div',
  Row: 'div',
  Heading: 'div',
  Cell: 'div',
  Toggle: 'button',
  Indent: 'span',
})

// A part that says what it is to a reader of the page.
let roled = (P: Part, role: string): Part => (p: Props) => h(P, { role, ...p })

// The arrow a sorted heading ends with: the way its rows run.
let arrow = (mod: Props['mod']) => {
  let mods = [mod].flat()
  return mods.includes('asc') ? ' ↑' : mods.includes('desc') ? ' ↓' : ''
}

// The tracks the columns run in, each named by what it holds (Table.css).
let template = (cols: Col[]) =>
  cols.map((k) => k ? `var(--col-${k}, var(--col))` : 'var(--col)').join(' ')

/** A table. */
export let Table:
  & FunctionComponent<TableProps>
  & Record<
    'Head' | 'Body' | 'Row' | 'Heading' | 'Cell' | 'Toggle' | 'Indent',
    Part
  > = Object
    .assign(
      ({ cols = [], ...p }: TableProps) =>
        h(Base, { role: 'table', ...p, style: { '--cols': template(cols) } }),
      {
        Head: roled(Base.Head, 'rowgroup'),
        Body: roled(Base.Body, 'rowgroup'),
        Row: roled(Base.Row, 'row'),
        Heading: ({ children, ...p }: Props) =>
          h(
            Base.Heading,
            { role: 'columnheader', ...p },
            children,
            arrow(p.mod),
          ),
        Cell: roled(Base.Cell, 'cell'),
        Toggle: Base.Toggle,
        Indent: (p: Props) => h(Base.Indent, { 'aria-hidden': true, ...p }),
      },
    )

/** What it is, in a line. */
export let description =
  'Things in rows under column headings, each cell one line.'

/** A grid of rows in a terminal too: every cell one line, cut with an
 * ellipsis, a number set right and prose wrapped; headings muted until they
 * sort; the row the keyboard is on raised. */
export let sheet = (c: Colors): Sheet => ({
  Table: { grid: true },
  Table_Row: { row: true },
  Table_Heading: { fg: c.muted, ellipsis: true },
  'Table_Heading-asc': { fg: c.accent },
  'Table_Heading-desc': { fg: c.accent },
  'Table_Heading-num': { align: 'right' },
  'Table_Row-focus': { bg: c.card, fg: c.text },
  'Table_Row-hover': { bg: c.surface },
  'Table_Row-quiet': { fg: c.muted },
  Table_Cell: { spaced: true, ellipsis: true },
  'Table_Cell-num': { fg: c.number, align: 'right' },
  'Table_Cell-key': { fg: c.muted },
  'Table_Cell-prose': { fg: c.muted, wrap: true },
  Table_Toggle: { fg: c.muted, glyph: '▸' },
  'Table_Toggle-open': { glyph: '▾' },
  Table_Indent: { glyph: '  ' },
})

let { Head, Body, Row, Heading, Cell, Toggle, Indent } = Table

let prop = (name: string, type: string, about: string, mod?: string) =>
  h(
    Row,
    { key: name, mod: ['picks', mod] },
    h(Cell, {}, name),
    h(Cell, {}, h(Value, { mod: 'id' }, type)),
    h(Cell, { mod: 'prose' }, about),
    h(Cell, { mod: 'num' }, '12,403'),
  )

let pair = (key: string, value: string, shape?: string) =>
  h(
    Row,
    { key },
    h(Cell, { mod: 'key' }, key),
    h(Cell, {}, h(Value, { mod: shape }, value)),
  )

// A specimen's own room, narrower than what its table holds.
let narrow: Props = { style: 'max-width: 22rem' }

// A row of a tree: as deep as it is, a toggle when it holds rows.
let branch = (
  depth: number,
  name: string,
  holds: string,
  n: string,
  open?: boolean | null,
) =>
  h(
    Row,
    { key: name, mod: 'picks' },
    h(
      Cell,
      {},
      Array.from({ length: depth }, (_, i) => h(Indent, { key: i })),
      open == null
        ? h(Indent, {})
        : h(Toggle, { type: 'button', mod: open && 'open' }),
      name,
    ),
    h(Cell, {}, holds),
    h(Cell, { mod: 'num' }, n),
  )

/** A table sorted by one column, with the keyboard on a row and one under
 * the pointer; a column too narrow for what it holds; a tree; and a table of
 * pairs. */
export let specimens = (): Specimen[] => [
  [
    'Table, Heading-sorts, Heading-desc, Heading-num, Row-picks, Row-focus, ' +
    'Row-hover, Row-quiet, Cell-prose, Cell-num',
    h(
      Table,
      { cols: [null, null, 'prose', 'num'] },
      h(
        Head,
        {},
        h(
          Row,
          {},
          h(Heading, { mod: 'sorts' }, 'name'),
          h(Heading, {}, 'type'),
          h(Heading, {}, 'description'),
          h(Heading, { mod: ['sorts', 'desc', 'num'] }, 'entities'),
        ),
      ),
      h(
        Body,
        {},
        prop('status', 'string · enum', 'where the task stands', 'focus'),
        prop('owner', 'ref → session', 'who holds it', 'hover'),
        prop(
          'seen',
          'string',
          'when it was last read, by whom, and through which session: ' +
            'prose wraps where a column of text would cut short',
        ),
        h(
          Row,
          { key: 'rest', mod: 'quiet' },
          h(Cell, {}, '3 more'),
          h(Cell, {}, ''),
          h(Cell, { mod: 'prose' }, 'what the rows above leave out'),
          h(Cell, { mod: 'num' }, '41'),
        ),
      ),
    ),
  ],
  [
    'Table, Cell cut short',
    h(
      'div',
      narrow,
      h(
        Table,
        { cols: [null, null, 'num'] },
        h(
          Body,
          {},
          h(
            Row,
            {},
            h(Cell, {}, 'T-105'),
            h(Cell, {}, 'The inspector shows every value where it stands'),
            h(Cell, { mod: 'num' }, '3'),
          ),
          h(
            Row,
            {},
            h(Cell, {}, 'T-98'),
            h(Cell, {}, 'A row keeps to one line'),
            h(Cell, { mod: 'num' }, '1,204'),
          ),
        ),
      ),
    ),
  ],
  [
    'Table, Toggle, Toggle-open, Indent',
    h(
      Table,
      { cols: [null, null, 'num'] },
      h(
        Body,
        {},
        branch(0, '@yaks/task', '4 components', '40,213', true),
        branch(1, 'task', 'a mark', '12,403', null),
        branch(1, 'filed', '4 properties', '12,000', true),
        branch(2, 'priority', 'number', ''),
        branch(0, '@yaks/topic', '2 components', '381', false),
      ),
    ),
  ],
  [
    'Table, Cell-key',
    h(
      Table,
      { cols: ['key', null] },
      h(
        Body,
        {},
        pair('title', 'Inspect the data model'),
        pair('priority', '2', 'num'),
        pair('assignee', 'null', 'nil'),
      ),
    ),
  ],
]
