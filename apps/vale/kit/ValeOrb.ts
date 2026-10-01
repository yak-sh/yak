/** A round action's face. Its selected and attention marks are supplied,
 * never inferred from a panel, inventory or input device. */
import { type Colors, el, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { type ComponentChildren, Fragment, h } from 'preact'

let Orb = el('button', 'ValeOrb')
export let ValeOrb = (
  { label, selected, attention, disabled, children }: {
    label: string
    selected?: boolean
    attention?: boolean
    disabled?: boolean
    children?: ComponentChildren
  },
) =>
  h(Orb, {
    type: 'button',
    'aria-label': label,
    'aria-pressed': selected,
    disabled,
    mod: [selected && 'on', attention && 'new'],
  }, children ?? label)
export let description = 'A round action, selected or asking for attention.'
export let sheet = (c: Colors): Sheet => ({
  ValeOrb: { fg: c.accent, bg: c.card },
  'ValeOrb-on': { fg: c.bg, bg: c.accent, bold: true },
  'ValeOrb-new': { underline: true },
})
let sample = (
  props: Parameters<typeof ValeOrb>[0],
  children?: ComponentChildren,
) => h(Fragment, {}, h(ValeOrb, props, children))
export let specimens = (): Specimen[] => [
  ['Map', sample({ label: 'Map' }, '⌖')],
  ['Selected', sample({ label: 'Journal', selected: true }, 'J')],
  ['Attention', sample({ label: 'Pack', attention: true }, 'P')],
  ['Unavailable', sample({ label: 'Party', disabled: true }, '♧')],
]
