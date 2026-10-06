/** Cardinal marks relative to a bearing, a tick between each two, with an
 * optional destination on the rim. Bearings are degrees clockwise from
 * north, supplied by a caller. A bearing or destination given as a signal
 * turns the rose without its being drawn again; it is drawn again only when
 * a destination comes or goes. */
import { block, type Colors, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { computed } from '@preact/signals'
import { Fragment, h } from 'preact'
import { useMemo } from 'preact/hooks'
import { type Live, read } from './live.ts'

let Compass = block('div', 'ValeCompass', {
  Mark: 'i',
  Tick: 'i',
  Goal: 'i',
  Read: 'span',
})
let degrees = (n: number) => Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0
export let ValeCompass = (
  { bearing = 0, destination }: {
    bearing?: Live<number>
    destination?: Live<number | undefined>
  },
) => {
  let shown = useMemo(() => {
    let turn = computed(() => degrees(read(bearing)))
    let goal = computed(() => {
      let at = read(destination)
      return at == null ? null : degrees(at)
    })
    return {
      aiming: computed(() => goal.value != null),
      heard: computed(() =>
        `Bearing ${turn.value}°` +
        (goal.value == null ? '' : `, destination ${goal.value}°`)
      ),
      turn: computed(() => `--turn:${turn.value}deg`),
      goal: computed(() => `--at:${goal.value ?? 0}deg`),
      read: computed(() => `${turn.value}°`),
    }
  }, [bearing, destination])
  return h(
    Compass,
    { role: 'img', 'aria-label': shown.heard, style: shown.turn },
    ['N', 'E', 'S', 'W'].map((mark, i) =>
      h(Compass.Mark, {
        key: mark,
        mod: i == 0 && 'north',
        'aria-hidden': true,
        style: { '--at': `${i * 90}deg` },
      }, mark)
    ),
    [45, 135, 225, 315].map((at) =>
      h(Compass.Tick, {
        key: at,
        'aria-hidden': true,
        style: { '--at': `${at}deg` },
      })
    ),
    shown.aiming.value
      ? h(Compass.Goal, { 'aria-hidden': true, style: shown.goal })
      : null,
    h(Compass.Read, { 'aria-hidden': true }, shown.read),
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
