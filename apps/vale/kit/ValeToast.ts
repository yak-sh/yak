/** A notice's face, without timers, dismissal, positioning or a live region.
 * Announcing and keeping a notice visible belong to its consumer. */
import { type Colors, el, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { type ComponentChildren, h } from 'preact'

let Toast = el('div', 'ValeToast')
export let ValeToast = (
  { tone = 'info', children }: {
    tone?: 'info' | 'positive' | 'negative' | 'special'
    children?: ComponentChildren
  },
) => h(Toast, { mod: tone }, children)
export let description = 'A short notice, coloured by its meaning.'
export let sheet = (c: Colors): Sheet => ({
  ValeToast: { fg: c.text, bg: c.card, wrap: true },
  'ValeToast-positive': { fg: c.positive },
  'ValeToast-negative': { fg: c.negative },
  'ValeToast-special': { fg: c.special, bold: true },
})
export let specimens = (): Specimen[] => [
  ['Notice', h(ValeToast, {}, 'The trail continues north.')],
  ['Success', h(ValeToast, { tone: 'positive' }, 'Quest completed')],
  ['Warning', h(ValeToast, { tone: 'negative' }, 'Inventory full')],
  ['Treasure', h(ValeToast, { tone: 'special' }, 'Legendary found')],
]
