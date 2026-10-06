/** A round action's face: on while what it opens is open or what it turns on
 * is on, dotted while something new waits behind it, calling while it wants
 * pressing, faded while what it does cannot be done (pressing it still says
 * why), and live while it sends (a voice going out). Its marks are supplied,
 * never inferred from a panel, inventory or input device; anything else an
 * element takes passes to the button. */
import { type Colors, el, type Props, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { Fragment, h } from 'preact'

let Orb = el('button', 'ValeOrb')
export type Marks = {
  selected?: boolean
  attention?: boolean
  calling?: boolean
  faded?: boolean
  live?: boolean
}
export let ValeOrb = (
  { label, selected, attention, calling, faded, live, children, ...props }:
    & Props
    & Marks
    & { label: string },
) =>
  h(Orb, {
    ...props,
    type: 'button',
    'aria-label': label,
    'aria-pressed': selected,
    mod: [
      selected && 'on',
      attention && 'new',
      calling && 'call',
      faded && 'off',
      live && 'live',
    ],
  }, children ?? label)
export let description =
  'A round action: on, with something new, calling, faded or live.'
export let sheet = (c: Colors): Sheet => ({
  ValeOrb: { fg: c.accent, bg: c.card },
  'ValeOrb-on': { fg: c.bg, bg: c.accent, bold: true },
  'ValeOrb-new': { underline: true },
  'ValeOrb-call': { bold: true },
  'ValeOrb-off': { dim: true },
  'ValeOrb-live': { fg: c.positive },
})
let sample = (props: Parameters<typeof ValeOrb>[0]) =>
  h(Fragment, {}, h(ValeOrb, props))
export let specimens = (): Specimen[] => [
  ['Map', sample({ label: 'Map', children: '⌖' })],
  ['Selected', sample({ label: 'Journal', selected: true, children: 'J' })],
  ['Attention', sample({ label: 'Pack', attention: true, children: 'P' })],
  ['Calling', sample({ label: 'Bag', calling: true, children: 'B' })],
  ['Faded', sample({ label: 'Microphone', faded: true, children: 'T' })],
  [
    'Live',
    sample({ label: 'Voice', selected: true, live: true, children: 'V' }),
  ],
  ['Unavailable', sample({ label: 'Party', disabled: true, children: '♧' })],
]
