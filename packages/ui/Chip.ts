/**
 * A name set as a token (`task`, `doc.title`), in one of six hues, `Chip-0`
 * to `Chip-5`, so names that recur on a page are told apart at a glance.
 * Which name wears which hue is the caller's. `Chip-ghost` is a name that is
 * there only as a possibility: absent, or not yet added. Given an `href` a
 * chip is a link (el.ts).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A name, as a token. */
export let Chip: Part = el('span', 'Chip')

/** How many hues a chip comes in. */
export let hues = 6

/** A hue is a colour; a ghost is dim. */
export let sheet = (c: Colors): Sheet => ({
  Chip: { fg: c.muted },
  'Chip-0': { fg: c.blue },
  'Chip-1': { fg: c.yellow },
  'Chip-2': { fg: c.purple },
  'Chip-3': { fg: c.green },
  'Chip-4': { fg: c.orange },
  'Chip-5': { fg: c.red },
  'Chip-ghost': { fg: c.dim, dim: true },
})

/** Every hue, and a ghost. */
export let specimens = (): Specimen[] => [
  ['Chip', h(Chip, {}, 'entity')],
  [
    'Chip-0 … Chip-5',
    h(
      'span',
      null,
      ['doc', 'task', 'filed', 'claim', 'created', 'updated'].map((name, i) => [
        i ? ' ' : '',
        h(Chip, { mod: String(i) }, name),
      ]),
    ),
  ],
  ['Chip-ghost', h(Chip, { mod: 'ghost' }, '+ memory')],
]
