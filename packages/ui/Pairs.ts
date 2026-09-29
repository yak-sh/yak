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
import type { Colors, Specimen } from './theme.ts'
import { Value } from './Value.ts'

/** Keys beside their values. */
export let Pairs: Part & Record<'Key' | 'Value', Part> = block('dl', 'Pairs', {
  Key: 'dt',
  Value: 'dd',
})

/** A key is dim, so the value reads first. */
export let sheet = (c: Colors): Sheet => ({
  Pairs_Key: { fg: c.dim },
})

let { Key, Value: At } = Pairs

/** Three pairs, each value its own shape. */
export let specimens = (): Specimen[] => [
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
