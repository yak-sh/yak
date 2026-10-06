/** When a bug's kept occurrences came, as bars over its life up to now: a
 * burst stands up, a quiet stretch lies flat, and a gap at the right end says
 * it has stopped. Drawn in SVG with the theme's roles, so it needs no sheet;
 * a terminal, which paints no SVG, reads the caption.
 * @module
 */
import { h, type JSX } from 'preact'
import { Stamp } from '@yaks/ui'
import { bins } from './spread.ts'

/// span(90 * 60_000) -> '1.5 hours'
/// span(36 * 3600_000) -> '1.5 days'
/// span(4 * 60_000) -> '4 minutes'
/** A stretch of time in the largest unit that keeps it above one. */
export let span = (ms: number): string => {
  let [n, unit]: [number, string] = ms >= 86_400_000
    ? [ms / 86_400_000, 'day']
    : ms >= 3_600_000
    ? [ms / 3_600_000, 'hour']
    : [ms / 60_000, 'minute']
  let r = Math.round(n * 10) / 10
  return `${r} ${unit}${r == 1 ? '' : 's'}`
}

let day = (t: number) =>
  new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  })

/** Bars of how many `ats` fall in each stretch from `from` to `to`. */
export let Histogram = (
  { ats, from, to, n = 48 }: {
    ats: string[]
    from: number
    to: number
    n?: number
  },
): JSX.Element => {
  let counts = bins(ats, from, to, n)
  let top = Math.max(1, ...counts)
  let w = 4, gap = 1, height = 40
  let step = (to - from) / n
  return h(
    'figure',
    { style: { margin: 0, display: 'grid', gap: '2px' } },
    h(
      'svg',
      {
        viewBox: `0 0 ${n * (w + gap)} ${height}`,
        preserveAspectRatio: 'none',
        width: '100%',
        height,
        role: 'img',
        'aria-label': `${ats.length} occurrences from ${day(from)} to ${
          day(to)
        }`,
      },
      h('line', {
        x1: 0,
        x2: n * (w + gap),
        y1: height - 0.5,
        y2: height - 0.5,
        stroke: 'var(--border2)',
        'vector-effect': 'non-scaling-stroke',
      }),
      counts.map((c, i) =>
        c
          ? h(
            'rect',
            {
              key: i,
              x: i * (w + gap),
              y: height - Math.max(2, c / top * height),
              width: w,
              height: Math.max(2, c / top * height),
              fill: 'var(--negative)',
              opacity: 0.75,
            },
            h(
              'title',
              {},
              `${c} from ${day(from + i * step)} to ${
                day(from + (i + 1) * step)
              }`,
            ),
          )
          : null
      ),
    ),
    h(
      'figcaption',
      { style: { display: 'flex', justifyContent: 'space-between' } },
      h(Stamp, {}, day(from)),
      h(Stamp, {}, `a bar is ${span(step)}, the tallest ${top}`),
      h(Stamp, {}, 'now'),
    ),
  )
}
