/**
 * A pip: a disc whose shape says a state and whose tone colours it, one
 * variant of each. What a state is, and which shape and tone say it, is the
 * application's: `<Dot mod={['half', 'active']} />` is paint, not a status.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A pip. */
export let Dot: Part = el('span', 'Dot')

/** Its shapes: the full disc, or one of these. */
export let shapes = [
  'ring',
  'dashed',
  'half',
  'pulse',
  'check',
  'cross',
  'alert',
]

/** Its tones: dim, or one of these, each a colour of the theme's. */
export let tones = [
  'info',
  'active',
  'positive',
  'negative',
  'caution',
  'accent',
  'special',
] satisfies (keyof Colors)[]

/** In a terminal, a shape is a glyph and a tone its colour. */
export let sheet = (c: Colors): Sheet => ({
  Dot: { glyph: '●', fg: c.dim },
  'Dot-ring': { glyph: '○' },
  'Dot-dashed': { glyph: '◌' },
  'Dot-half': { glyph: '◐' },
  'Dot-pulse': { bold: true },
  'Dot-check': { glyph: '✓' },
  'Dot-cross': { glyph: '✕' },
  'Dot-alert': { glyph: '!', bold: true },
  ...Object.fromEntries(tones.map((t) => [`Dot-${t}`, { fg: c[t] }])),
})

/** Every shape, then every tone on the full disc and on a ring. */
export let specimens = (): Specimen[] => [
  ['Dot', h(Dot, {})],
  ...shapes.map((s): Specimen => [`Dot-${s}`, h(Dot, { mod: s })]),
  ...tones.map((t): Specimen => [
    `Dot-${t}`,
    h(
      'span',
      null,
      h(Dot, { mod: t }),
      ' ',
      h(Dot, { mod: ['ring', t] }),
      ' ',
      h(Dot, { mod: ['half', t] }),
    ),
  ]),
]
