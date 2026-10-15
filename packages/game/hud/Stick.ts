/** A touch stick's face, positioned by its caller in viewport pixels. It
 * owns no input state: the base follows x/y, the knob follows pixel offsets
 * dx/dy, and rest puts both back in the CSS resting position. */
import { block, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { Fragment, type FunctionComponent, h } from 'preact'

/** Display values only; input handling belongs to the controls consumer. */
export type StickProps = {
  x?: number
  y?: number
  dx?: number
  dy?: number
  rest?: boolean
}

let Face = block('div', 'Stick', { Knob: 'span' })
let pixel = (n: number) => Number.isFinite(n) ? n : 0

/** A decorative face: resting by default, otherwise under the touch. */
export let Stick: FunctionComponent<StickProps> = (
  { x = 0, y = 0, dx = 0, dy = 0, rest = true }: StickProps,
) =>
  h(
    Face,
    {
      mod: rest && 'rest',
      'aria-hidden': true,
      style: rest ? undefined : {
        transform: `translate(${pixel(x)}px, ${pixel(y)}px)`,
      },
    },
    h(Face.Knob, {
      style: rest ? undefined : {
        transform: `translate(${pixel(dx)}px, ${pixel(dy)}px)`,
      },
    }),
  )

export let description = 'A touch stick face positioned by its controls.'
/** Touch-only decoration has no terminal input affordance. */
export let sheet = (): Sheet => ({ Stick: { hidden: true } })
export let specimens = (): Specimen[] => [
  ['Resting touch stick', h(Fragment, {}, h(Stick, {}))],
  [
    'Held touch stick',
    h(Fragment, {}, h(Stick, { rest: false, x: 80, y: 80, dx: 20, dy: -10 })),
  ],
]
