/** A labelled quantity, with a bounded fill and readable numbers in either
 * renderer. The caller supplies the value; this part never advances it. A
 * value given as a signal moves the fill, the numbers and what is heard
 * without the meter being drawn again, for one that changes every frame.
 * Words given as children stand over the fill in place of the label and its
 * numbers, in a row; the label and the numbers are still what is heard. */
import { block, type Colors, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { computed } from '@preact/signals'
import { type ComponentChildren, Fragment, h } from 'preact'
import { useMemo } from 'preact/hooks'
import { type Live, read } from './live.ts'

let Meter = block('div', 'ValeMeter', { Fill: 'i', Label: 'span' })
export type MeterProps = {
  label: string
  value: Live<number>
  max: number
  tone?: 'health' | 'experience' | 'danger'
  children?: ComponentChildren
}

export let ValeMeter = (
  { label, value, max, tone = 'health', children }: MeterProps,
) => {
  let limit = Number.isFinite(max) ? Math.max(0, max) : 0
  let shown = useMemo(() => {
    let amount = computed(() => {
      let v = read(value)
      return Number.isFinite(v) ? Math.max(0, Math.min(limit, v)) : 0
    })
    return {
      amount,
      fill: computed(() => `--k:${limit ? amount.value / limit : 0}`),
      words: computed(() => `${label} ${amount.value}/${limit}`),
    }
  }, [value, limit, label])
  return h(
    Meter,
    {
      mod: tone,
      role: 'meter',
      'aria-label': label,
      'aria-valuemin': 0,
      'aria-valuemax': limit,
      'aria-valuenow': shown.amount,
      style: shown.fill,
    },
    h(Meter.Fill, { 'aria-hidden': true }),
    h(Meter.Label, {}, children ?? shown.words),
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
  [
    'Words of its own',
    sample({
      label: 'Garden toad',
      value: 31,
      max: 48,
      tone: 'danger',
      children: 'Garden toad · level 7',
    }),
  ],
]
