/**
 * Things in rows under column headings: `Table.Head` holds a `Table.Row` of
 * `Table.Heading`s, and `Table.Body` a `Table.Row` of `Table.Cell`s for each
 * thing. A row a press picks wears `Row-picks`, the picked one `Row-on`, the
 * one under the pointer `Row-hover`. A heading a press sorts by wears
 * `Heading-sorts`, and `Heading-asc` or `Heading-desc` once the rows run by
 * it, which its arrow says. A cell is `Cell-num` for a number, set right;
 * `Cell-key` for the name of what its row holds, in a table of pairs; and
 * `Cell-prose` for text that wraps rather than cutting short. What a press on
 * a row or a heading does is the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Value } from './Value.ts'

let Base = block('table', 'Table', {
  Head: 'thead',
  Body: 'tbody',
  Row: 'tr',
  Heading: 'th',
  Cell: 'td',
})

// The arrow a sorted heading ends with: the way its rows run.
let arrow = (mod: Props['mod']) => {
  let mods = [mod].flat()
  return mods.includes('asc') ? ' ↑' : mods.includes('desc') ? ' ↓' : ''
}

let Th = Base.Heading

/** A table. */
export let Table:
  & Part
  & Record<'Head' | 'Body' | 'Row' | 'Heading' | 'Cell', Part> = Object
    .assign(Base, {
      Heading: ({ children, ...p }: Props) => h(Th, p, children, arrow(p.mod)),
    })

/** Headings dim until they sort; the picked row raised; a number purple. */
export let sheet = (c: Colors): Sheet => ({
  Table_Heading: { fg: c.dim },
  'Table_Heading-asc': { fg: c.accent },
  'Table_Heading-desc': { fg: c.accent },
  'Table_Row-on': { bg: c.card, fg: c.text },
  'Table_Row-hover': { bg: c.surface },
  Table_Cell: { spaced: true },
  'Table_Cell-num': { fg: c.purple },
  'Table_Cell-key': { fg: c.dim },
})

let { Head, Body, Row, Heading, Cell } = Table

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

/** A table sorted by one column, with a row picked and one under the
 * pointer; and a table of pairs. */
export let specimens = (): Specimen[] => [
  [
    'Table, Heading-sorts, Heading-desc, Row-picks, Row-on, Row-hover, ' +
    'Cell-prose, Cell-num',
    h(
      Table,
      {},
      h(
        Head,
        {},
        h(
          Row,
          {},
          h(Heading, { mod: 'sorts' }, 'name'),
          h(Heading, {}, 'type'),
          h(Heading, {}, 'description'),
          h(Heading, { mod: ['sorts', 'desc'] }, 'entities'),
        ),
      ),
      h(
        Body,
        {},
        prop('status', 'string · enum', 'where the task stands', 'on'),
        prop('owner', 'ref → session', 'who holds it', 'hover'),
        prop('seen', 'string', 'when it was last read'),
      ),
    ),
  ],
  [
    'Table, Cell-key',
    h(
      Table,
      {},
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
