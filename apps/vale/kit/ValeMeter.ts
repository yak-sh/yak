/** A labelled quantity, with a bounded fill and readable numbers in either
 * renderer. The caller supplies the value; this part never advances it. */
import { block, type Colors, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { Fragment, h } from 'preact'

let Meter = block('div', 'ValeMeter', { Fill: 'i', Label: 'span' })
export type MeterProps = {
  label: string
  value: number
  max: number
  tone?: 'health' | 'experience' | 'danger'
}

export let ValeMeter = (
  { label, value, max, tone = 'health' }: MeterProps,
) => {
  let limit = Number.isFinite(max) ? Math.max(0, max) : 0
  let amount = Number.isFinite(value) ? Math.max(0, Math.min(limit, value)) : 0
  return h(
    Meter,
    {
      mod: tone,
      role: 'meter',
      'aria-label': label,
      'aria-valuemin': 0,
      'aria-valuemax': limit,
      'aria-valuenow': amount,
      style: { '--k': limit ? amount / limit : 0 },
    },
    h(Meter.Fill, { 'aria-hidden': true }),
    h(Meter.Label, {}, `${label} ${amount}/${limit}`),
  )
}

export let description = 'A quantity over its coloured fill.'
export let sheet = (c: Colors): Sheet => ({
  ValeMeter: { fg: c.text },
  'ValeMeter-health': { fg: c.negative },
  'ValeMeter-experience': { fg: c.info },
  'ValeMeter-danger': { fg: c.caution },
})
let sample = (props: Parameters<typeof ValeMeter>[0]) =>
  h(Fragment, {}, h(ValeMeter, props))
export let specimens = (): Specimen[] => [
  ['Health', sample({ label: 'Health', value: 72, max: 100 })],
  [
    'Experience',
    sample({
      label: 'Experience',
      value: 24,
      max: 60,
      tone: 'experience',
    }),
  ],
]
