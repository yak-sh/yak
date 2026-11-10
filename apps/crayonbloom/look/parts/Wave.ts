/** A torn-paper edge between the top of a page and the rest: decoration. */
import { h } from 'preact'
import { el, type Part } from '@yaks/ui/parts'

let Edge = el('div', 'Wave')

export let Wave: Part = (props) =>
  h(
    Edge,
    { 'aria-hidden': true, ...props },
    h(
      'svg',
      { viewBox: '0 0 1200 36', preserveAspectRatio: 'none', fill: 'none' },
      h('path', {
        d: 'M0 18c80-16 160-16 240 0s160 16 240 0 160-16 240 0 160 16 240 0 160-16 240 0v18H0Z',
        fill: 'currentColor',
        opacity: 0.08,
      }),
      h('path', {
        d: 'M0 14c80-16 160-16 240 0s160 16 240 0 160-16 240 0 160 16 240 0 160-16 240 0',
        stroke: 'currentColor',
        'stroke-width': 2.4,
        'stroke-linecap': 'round',
        opacity: 0.32,
      }),
    ),
  )
