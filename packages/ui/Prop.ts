/**
 * A property's value that knows how to be changed (@yaks/editors `Prop`): its
 * face in a `Val`, `live` when a press opens its editor, `nil` when there is
 * nothing to show; a quiet `Hand` beside a face that is a link, so the link
 * keeps its click. The editors it opens: a `Pop` of `Tab`s for a closed set,
 * a `Pop-list` of `Row`s under a `Find` for a search, and a `Query` around a
 * query field.
 *
 * A `Pop` is a box only: where it floats is its host's (an `Overlay`).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A value that can be changed, and its editors' parts. */
export let Prop:
  & Part
  & Record<
    'Val' | 'Hand' | 'Pop' | 'Tab' | 'Row' | 'Find' | 'Query',
    Part
  > = block('span', 'Prop', {
    Val: 'span',
    Hand: 'button',
    Pop: 'span',
    Tab: 'button',
    Row: 'span',
    Find: 'input',
    Query: 'span',
  })

/** The face is ink; what is not there, and a handle, are dim. */
export let sheet = (c: Colors): Sheet => ({
  Prop_Val: { fg: c.text },
  'Prop_Val-nil': { fg: c.dim },
  Prop_Hand: { fg: c.dim },
  'Prop_Tab-on': { fg: c.text, bold: true },
  Prop_Tab: { fg: c.muted },
  'Prop_Row-none': { fg: c.dim },
})

let { Val, Hand, Pop, Tab, Row, Find } = Prop

/** A value, one with nothing, a link's handle, and each editor. */
export let specimens = (): Specimen[] => [
  ['Prop-live, Val', h(Prop, { mod: 'live' }, h(Val, {}, 'Inspect the model'))],
  ['Prop, Val-nil', h(Prop, {}, h(Val, { mod: 'nil' }, '—'))],
  [
    'Prop, Hand',
    h(
      Prop,
      { mod: 'live' },
      h(Val, {}, h('a', { href: '#p' }, 'P-19')),
      ' ',
      h(Hand, { type: 'button' }, '▾'),
    ),
  ],
  [
    'Prop_Pop, Tab-on',
    h(
      Pop,
      {},
      ['open', 'done', 'cancelled'].map((v) =>
        h(Tab, { key: v, type: 'button', mod: v == 'open' && 'on' }, v)
      ),
    ),
  ],
  [
    'Prop_Pop-list, Find, Row-none',
    h(
      Pop,
      { mod: 'list' },
      h(Find, { placeholder: 'search…' }),
      h(Row, { mod: 'none' }, 'none'),
      h(Row, {}, 'T-9 — Draw the map'),
    ),
  ],
]
