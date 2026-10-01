/** Cardinal marks relative to a bearing, with an optional destination on
 * the rim. Bearings are degrees clockwise from north, supplied by a caller. */
import { block, type Colors, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { Fragment, h } from 'preact'

let Compass = block('div', 'ValeCompass', {
  Mark: 'i',
  Goal: 'i',
  Read: 'span',
})
let degrees = (n: number) => Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0
export let ValeCompass = (
  { bearing = 0, destination }: { bearing?: number; destination?: number },
) => {
  let turn = degrees(bearing)
  return h(
    Compass,
    {
      role: 'img',
      'aria-label': `Bearing ${turn}°` +
        (destination == null ? '' : `, destination ${degrees(destination)}°`),
      style: { '--turn': `${turn}deg` },
    },
    ['N', 'E', 'S', 'W'].map((mark, i) =>
      h(Compass.Mark, {
        key: mark,
        mod: i == 0 && 'north',
        'aria-hidden': true,
        style: { '--at': `${i * 90}deg` },
      }, mark)
    ),
    destination == null ? null : h(Compass.Goal, {
      'aria-hidden': true,
      style: { '--at': `${degrees(destination)}deg` },
    }),
    h(Compass.Read, { 'aria-hidden': true }, `${turn}°`),
  )
}
export let description = 'A bearing and destination on a compass rose.'
export let sheet = (c: Colors): Sheet => ({
  ValeCompass: { fg: c.muted, spaced: true },
  'ValeCompass_Mark-north': { fg: c.negative, bold: true },
  ValeCompass_Goal: { glyph: '◆', fg: c.caution },
  ValeCompass_Read: { fg: c.number },
})
let sample = (props: Parameters<typeof ValeCompass>[0]) =>
  h(Fragment, {}, h(ValeCompass, props))
export let specimens = (): Specimen[] => [
  ['North', sample({})],
  ['Trail bearing', sample({ bearing: 75, destination: 110 })],
]
