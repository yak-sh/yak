/**
 * Names beside their values, one pair to a row: `Pairs.Key` then
 * `Pairs.Value`, as a description list. A browser lines the values up in a
 * column; a terminal writes `key: value`.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'
import { Value } from './Value.ts'

/** Keys beside their values. */
export let Pairs: Part & Record<'Key' | 'Value' | 'Row', Part> = block(
  'dl',
  'Pairs',
  {
    Row: 'div',
    Key: 'dt',
    Value: 'dd',
  },
)

/** What it is, in a line. */
export let description = 'Names beside their values, one pair to a row.'

/** A key is muted, so the value reads first. */
export let sheet = (c: Colors): Sheet => ({
  Pairs_Key: { fg: c.muted },
})

let { Key, Value: At } = Pairs

/** Three pairs, each value its own shape. */
export let specimens = (): Specimen[] => [
  [
    'Pairs, variants',
    h(
      Pairs,
      { mod: 'nested' },
      h(
        Pairs.Row,
        {},
        h(Pairs.Key, {}, 'File'),
        h(Pairs.Value, {}, 'notes.txt'),
      ),
      h(
        Pairs.Row,
        {},
        h(Pairs.Key, {}, 'Details'),
        h(
          Pairs.Value,
          {},
          h(
            Pairs,
            { mod: 'nested' },
            h(
              Pairs.Row,
              {},
              h(Pairs.Key, {}, 'Lines'),
              h(Pairs.Value, {}, '12'),
            ),
          ),
        ),
      ),
    ),
  ],
  [
    'Pairs, Key, Value',
    h(
      Pairs,
      {},
      h(Key, {}, 'title'),
      h(At, {}, h(Value, {}, 'Inspect the data model')),
      h(Key, {}, 'priority'),
      h(At, {}, h(Value, { mod: 'num' }, '2')),
      h(Key, {}, 'assignee'),
      h(At, {}, h(Value, { mod: 'nil' }, 'null')),
    ),
  ],
]

/** The same interface on a native host. */
export let native = (_c: Colors): Native => ({
  'Pairs-nested': { gap: 4 },
})
