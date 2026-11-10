/** A word underlined with a crayon squiggle, in coral: the one word of a
 * headline that carries it. */
import { h } from 'preact'
import { el, type Part } from '@yaks/ui/parts'

let Word = el('span', 'Squig')
let Line = el('svg', 'Squig_Line')

export let Squig: Part = ({ children, ...props }) =>
  h(
    Word,
    props,
    children,
    h(
      Line,
      {
        viewBox: '0 0 200 16',
        preserveAspectRatio: 'none',
        'aria-hidden': true,
      },
      h('path', {
        d: 'M3 9c30-8 70-8 98-3 28 5 60 4 96-4',
        fill: 'none',
        'stroke-width': 5,
        'stroke-linecap': 'round',
      }),
    ),
  )
