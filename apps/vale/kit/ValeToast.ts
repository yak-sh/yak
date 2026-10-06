/** A notice's face, without timers, dismissal, positioning or a live region:
 * `info` says what happened, `big` marks a moment (a level, a place, a
 * quest), `gain` names a thing come into the bag in its rarity's colour
 * (`--rarity`, ui/Rarity.css), and `special` a legendary one, glowing.
 * Announcing and keeping a notice visible belong to its consumer; anything
 * else an element takes passes to it. */
import { type Colors, el, type Props, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'

let Toast = el('div', 'ValeToast')
export type Tone = 'info' | 'big' | 'gain' | 'special'
export let ValeToast = (
  { tone = 'info', ...props }: Props & { tone?: Tone },
) => h(Toast, { ...props, mod: tone })
export let description = 'A short notice: news, a moment, or a thing gained.'
export let sheet = (c: Colors): Sheet => ({
  ValeToast: { fg: c.text, bg: c.card, wrap: true },
  'ValeToast-big': { fg: c.accent, bold: true },
  'ValeToast-gain': { fg: c.number },
  'ValeToast-special': { fg: c.special, bold: true },
})
export let specimens = (): Specimen[] => [
  ['Notice', h(ValeToast, {}, 'The trail continues north.')],
  ['Moment', h(ValeToast, { tone: 'big' }, 'Level 5! You feel stronger.')],
  ['Gain', h(ValeToast, { tone: 'gain' }, 'Boar tusk ×2')],
  ['Legendary', h(ValeToast, { tone: 'special' }, 'Legendary! Ember blade')],
]
