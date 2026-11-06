/**
 * A name set as a token (`task`, `doc.title`), in one of six hues, `Chip-0`
 * to `Chip-5`, so names that recur on a page are told apart at a glance.
 * Which name wears which hue is the caller's. `Chip-ghost` is a name that is
 * there only as a possibility: absent, or not yet added. `Chip-quiet` is a
 * label that steps back (an address in a window bar), `Chip-code` words a
 * person copies (a URL), and a `Chip.Tag` inside one says what it is a
 * kind of. Given an `href` a chip is a link (el.ts). A row of them is
 * `Chips`.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A name, as a token, and what it is a kind of. */
export let Chip: Part & Record<'Tag', Part> = block('span', 'Chip', {
  Tag: 'span',
})

/** How many hues a chip comes in. */
export let hues = 6

/** What it is, in a line. */
export let description =
  'A name set as a token, in one of six hues that tell names apart.'

/** A hue is a colour; a ghost is dim; a tag and a quiet chip are muted. */
export let sheet = (c: Colors): Sheet => ({
  Chip: { fg: c.muted },
  ...Object.fromEntries(c.hues.map((fg, i) => [`Chip-${i}`, { fg }])),
  'Chip-ghost': { fg: c.dim, dim: true },
  'Chip-quiet': { fg: c.muted },
  'Chip-code': { fg: c.text },
  Chip_Tag: { fg: c.muted },
})

/** Every hue, a ghost, a quiet one, words to copy, and a link with a tag. */
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
  ['Chip-quiet', h(Chip, { mod: 'quiet' }, 'ada.yaks.app/recipes')],
  ['Chip-code', h(Chip, { mod: 'code' }, 'https://yaks.app/mcp')],
  [
    'Chip, href, Tag',
    h(Chip, { href: '#recipes' }, 'Recipe box', h(Chip.Tag, {}, 'public')),
  ],
]
