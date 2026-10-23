/**
 * The few numbers a page is about, side by side, each large over what it
 * counts: `Stats` holds a `Stats.Item` for each, its `Stats.Value` over its
 * `Stats.Label`, and under them, where there is one, a `Stats.Note`: a
 * `Spark`, or a line of words. A value that needs watching wears
 * `Value-caution`; one saying something went wrong, `Value-negative`.
 *
 * A browser sets as many to a line as fit, each a tile; a terminal gives each
 * a line of its own, the value first.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Spark } from './Spark.ts'

/** Numbers over what they count. */
export let Stats: Part & Record<'Item' | 'Value' | 'Label' | 'Note', Part> =
  block('div', 'Stats', {
    Item: 'div',
    Value: 'div',
    Label: 'div',
    Note: 'div',
  })

/** What it is, in a line. */
export let description =
  'The few numbers a page is about, side by side, each large over what it counts.'

/** The value says itself first and boldly, in its tone; what it counts is
 * muted. */
export let sheet = (c: Colors): Sheet => ({
  Stats_Item: { block: true, spaced: true },
  Stats_Value: { fg: c.text, bold: true },
  'Stats_Value-caution': { fg: c.caution, bold: true },
  'Stats_Value-negative': { fg: c.negative, bold: true },
  Stats_Label: { fg: c.muted },
  Stats_Note: { fg: c.muted },
})

let { Item, Value, Label, Note } = Stats

/** Four numbers: one with a series under it, one to watch and one gone
 * wrong. */
export let specimens = (): Specimen[] => [
  [
    'Stats, Item, Value, Label, Note, Value-caution, Value-negative',
    h(
      Stats,
      {},
      h(Item, {}, h(Value, {}, '2'), h(Label, {}, 'workers')),
      h(
        Item,
        {},
        h(Value, {}, '14.2'),
        h(Label, {}, 'runs a second'),
        h(Note, {}, h(Spark, { values: [0, 2, 5, 9, 7, 4, 8, 12, 14, 11] })),
      ),
      h(Item, {}, h(Value, { mod: 'caution' }, '340'), h(Label, {}, 'waiting')),
      h(Item, {}, h(Value, { mod: 'negative' }, '12'), h(Label, {}, 'failed')),
    ),
  ],
]
