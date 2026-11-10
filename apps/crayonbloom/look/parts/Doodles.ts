/** Crayon doodles scattered behind the top of the home page: two sparks, a
 * swirl, a loop and three dots. Decoration, the larger ones hidden where
 * there is no room. A doodle that is filled is `Doodles.Doodle-fill`. */
import { h } from 'preact'
import { el, type Part } from '@yaks/ui/parts'

let Frame = el('div', 'Doodles')
let Doodle = el('svg', 'Doodles_Doodle')
let drawn = (mod: string[], viewBox: string, ...paths: string[]) =>
  h(Doodle, { mod, viewBox }, paths.map((d) => h('path', { d })))
let dot = (cx: number) => `M${cx - 4} 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z`

export let Doodles: Part = (props) =>
  h(
    Frame,
    { 'aria-hidden': true, ...props },
    drawn(
      ['spark', 'fill'],
      '0 0 40 40',
      'M20 3c1.5 8.5 8.5 15.5 17 17-8.5 1.5-15.5 8.5-17 17-1.5-8.5-8.5-15.5-17-17 8.5-1.5 15.5-8.5 17-17Z',
    ),
    drawn(
      ['swirl'],
      '0 0 64 40',
      'M3 30c10 8 22 6 26-4 3-7-2-14-9-13-6 1-8 8-3 11 6 3 13-2 16-9 3-6 10-9 18-6',
    ),
    drawn(
      ['glint', 'fill'],
      '0 0 28 28',
      'M14 2c1 6 6 11 12 12-6 1-11 6-12 12-1-6-6-11-12-12 6-1 11-6 12-12Z',
    ),
    drawn(
      ['loop'],
      '0 0 70 36',
      'M4 20c6-14 20-18 27-8 5 7-1 16-9 15-7-1-9-10-2-14 8-4 18 0 24 8 4 5 9 7 13 5',
    ),
    drawn(['dots', 'fill'], '0 0 44 16', dot(6), dot(22), dot(38)),
  )
