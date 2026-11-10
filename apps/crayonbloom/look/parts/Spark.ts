/** Where an idea is typed: a white box holding a pencil, a bare field to
 * write the idea in and, at its foot (`Spark.Foot`), the press that sends
 * it. `Spark.Ideas` under it is a row of ideas to borrow, led by a few
 * words (`Spark.Lead`). */
import { type ComponentChildren, h } from 'preact'
import { block, type Props } from '@yaks/ui/parts'

let Pencil = () =>
  h(
    'svg',
    {
      width: 22,
      height: 22,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': true,
    },
    h('path', { d: 'm14.5 3.5 6 6L8 22l-6 1 1-6Z' }),
    h('path', { d: 'm12.5 5.5 6 6' }),
  )

let Frame = block('form', 'Spark', {
  Box: 'div',
  Write: 'div',
  Foot: 'div',
  Ideas: 'div',
  Lead: 'span',
})

/** `write` is the field, `foot` what sends it; children follow the box. */
export let Spark = Object.assign(
  (
    { write, foot, children, ...props }: Props & {
      write: ComponentChildren
      foot: ComponentChildren
    },
  ) =>
    h(
      Frame,
      props,
      h(
        Frame.Box,
        {},
        h(Frame.Write, {}, h(Pencil, {}), write),
        h(Frame.Foot, {}, foot),
      ),
      children,
    ),
  { Ideas: Frame.Ideas, Lead: Frame.Lead },
)
