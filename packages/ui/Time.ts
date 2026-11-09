/** A date's shared face: its age, with the full timestamp in a kit tooltip.
 * @module
 */
import { type FunctionComponent, h } from 'preact'
import type { Clock } from '@yaks/fp'
import { useNow } from './clock.ts'
import type { H } from '@yaks/render'
import type { Sheet } from '@yaks/tui/theme'
import { type Props } from './el.ts'
import { day, pretty, relative } from './relative.ts'
import type { Colors, Specimen } from './theme.ts'

/** The moment and, for a controlled rendering, the clock it is read against. */
export type TimeProps = Props & {
  clock?: Clock
  at?: string | null
  now?: number
  written?: boolean
  timeZone?: string
}

/** The kit face through a portable renderer's hyperscript. */
export let time = <N>(
  h: H<N>,
  { at, now, written, timeZone, clock: _clock, title: _title, ...props }:
    TimeProps,
): N | null => {
  let full = pretty(at, timeZone)
  return at && full
    ? h('time', {
      ...props,
      class: ['Time', props.class].filter(Boolean).join(' '),
      datetime: at,
      'data-zone': timeZone,
      tabindex: props.tabindex ?? 0,
      'data-tip': full,
      'data-relative': written ? undefined : '',
    }, written ? day(at, timeZone) : relative(at, now))
    : null
}

/** A moment in words, focusable so its tooltip is available by keyboard. */
export let Time: FunctionComponent<TimeProps> = (props) => {
  let now = useNow(props.clock)
  return time(h, { ...props, now: props.now ?? now })
}

/** What it is, in a line. */
export let description = 'An ago date, with its full timestamp in a tooltip.'
/** The surrounding line owns its size and colour. */
export let sheet = (_c: Colors): Sheet => ({})
/** An age and a written date. */
export let specimens = (): Specimen[] => [
  [
    'Time',
    h(Time, {
      at: '2026-11-06T15:42:00Z',
      now: 1794238920000,
      timeZone: 'UTC',
    }),
  ],
  [
    'Time, written',
    h(Time, {
      at: '2026-11-06T15:42:00Z',
      now: 1794238920000,
      timeZone: 'UTC',
      written: true,
    }),
  ],
]
