/**
 * A series over time, one character a value, each as tall as its share of
 * the largest: `<Spark values={[0, 2, 5, 3]} />`. A value of nothing sits on
 * the floor, dim. `max` sets the top where a series is read against a fixed
 * one rather than its own largest. The series is drawn in characters, so a
 * browser and a terminal paint one line.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Base: Part & Record<'Bar' | 'Floor', Part> = block('span', 'Spark', {
  Bar: 'span',
  Floor: 'span',
})

let BARS = '▁▂▃▄▅▆▇█'

/**
 * The characters a series draws: an eighth of a cell for each eighth of the
 * top, at least one for anything at all.
 *
 * ```ts
 * import { bars } from './Spark.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(bars([0, 1, 2, 4]), '▁▂▄█')
 * equal(bars([1, 2], 16), '▁▁')
 * ```
 */
export let bars = (values: number[], max = Math.max(0, ...values)): string =>
  values.map((v) =>
    v > 0 && max > 0
      ? BARS[Math.min(7, Math.max(0, Math.ceil(v / max * 8) - 1))]
      : BARS[0]
  ).join('')

/** What a spark is drawn with: its values, the top they are read against,
 * and anything a part takes. */
export type SparkProps = Props & { values?: number[]; max?: number }

/** A series, a character a value. */
export let Spark: FunctionComponent<SparkProps> = (
  { values = [], max, ...rest },
) => {
  let line = [...bars(values, max)]
  // Runs of nothing and runs of something, each one piece.
  let pieces: [boolean, string][] = []
  values.forEach((v, i) => {
    let some = v > 0
    let last = pieces.at(-1)
    if (last && last[0] == some) last[1] += line[i]
    else pieces.push([some, line[i]])
  })
  return h(
    Base,
    {
      role: 'img',
      'aria-label': values.join(' '),
      ...rest,
    },
    pieces.map(([some, chars]) => h(some ? Base.Bar : Base.Floor, {}, chars)),
  )
}

/** What it is, in a line. */
export let description =
  'A series over time, one character a value, each as tall as its share of the largest.'

/** What there is is the accent; nothing at all is dim. */
export let sheet = (c: Colors): Sheet => ({
  Spark_Bar: { fg: c.accent },
  Spark_Floor: { fg: c.dim },
})

/** A busy minute, and one read against a fixed top. */
export let specimens = (): Specimen[] => [
  [
    'Spark, Bar, Floor',
    h(Spark, { values: [0, 0, 1, 3, 4, 2, 0, 5, 8, 6, 3, 1, 0, 0, 2, 4] }),
  ],
  ['Spark, max', h(Spark, { values: [1, 2, 3, 2, 1], max: 10 })],
]
