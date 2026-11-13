/** A date's shared face: its age, its day, or how long since it, with the
 * full timestamp in a kit tooltip.
 * @module
 */
import { type FunctionComponent, h } from 'preact'
import type { Clock } from '@yaks/fp'
import { useNow } from './clock.ts'
import type { H } from '@yaks/render'
import type { Sheet } from '@yaks/tui/theme'
import { type Props } from './el.ts'
import { type Face, said, tip } from './relative.ts'
import type { Colors, Specimen } from './theme.ts'

/** The moment and, for a controlled rendering, the clock it is read against.
 * `written` says its day instead of its age, and `lasting` how long it has
 * been since. */
export type TimeProps = Props & Face & {
  clock?: Clock
  at?: string | null
}

/** The kit face through a portable renderer's hyperscript. */
export let time = <N>(
  h: H<N>,
  {
    at,
    now,
    written,
    lasting,
    timeZone,
    clock: _clock,
    title: _title,
    ...props
  }: TimeProps,
): N | null => {
  let face = { now, written, lasting, timeZone }
  let full = at ? tip(at, face) : ''
  return at && full
    ? h('time', {
      ...props,
      class: ['Time', props.class].filter(Boolean).join(' '),
      datetime: at,
      'data-zone': timeZone,
      tabindex: props.tabindex ?? 0,
      'data-tip': full,
      'data-relative': written || lasting ? undefined : '',
      'data-lasting': lasting ? '' : undefined,
    }, said(at, face))
    : null
}

/** A moment in words, focusable so its tooltip is available by keyboard. A
 * duration is read every second, an age every minute. */
export let Time: FunctionComponent<TimeProps> = (props) => {
  let now = useNow(props.clock, props.lasting ? 1000 : 60_000)
  return time(h, { ...props, now: props.now ?? now })
}

/** What it is, in a line. */
export let description =
  'An ago date, a day or a duration, with its full timestamp in a tooltip.'
/** The surrounding line owns its size and colour. */
export let sheet = (_c: Colors): Sheet => ({})
/** An age, a written date and a duration. */
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
  [
    'Time, lasting',
    h(Time, {
      at: '2026-11-09T15:38:48Z',
      now: 1794238920000,
      timeZone: 'UTC',
      lasting: true,
    }),
  ],
]
