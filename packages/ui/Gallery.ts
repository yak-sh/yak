/**
 * Things side by side, each shown on a `Gallery.Stage` of its own under a
 * `Gallery.Caption` naming it, the two a `Gallery.Figure`. What is shown is
 * the caller's: a part in one of its variants, a picture, a page in small.
 *
 * A browser sets as many figures to a line as fit, each as wide as what it
 * shows asks and growing to fill the line. A terminal stacks them, each
 * caption over its stage, the stage indented under it.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'
import { Chip } from './Chip.ts'
import { Dot } from './Dot.ts'

/** A gallery. */
export let Gallery: Part & Record<'Figure' | 'Caption' | 'Stage', Part> = block(
  'div',
  'Gallery',
  {
    Figure: 'figure',
    Caption: 'figcaption',
    Stage: 'div',
  },
)

/** What it is, in a line. */
export let description =
  'Things side by side, each on a stage of its own under a caption naming it.'

/** Each figure its caption, muted, over its stage, indented, then a blank
 * line. */
export let sheet = (c: Colors): Sheet => ({
  Gallery_Figure: { gap: true },
  Gallery_Caption: { fg: c.muted },
  Gallery_Stage: { indent: 2 },
})

let { Figure, Caption, Stage } = Gallery

/** Three figures, one wider than the others. */
export let specimens = (): Specimen[] => [
  [
    'Gallery, Figure, Caption, Stage',
    h(
      Gallery,
      {},
      h(Figure, {}, h(Caption, {}, 'a pip'), h(Stage, {}, h(Dot, {}))),
      h(
        Figure,
        {},
        h(Caption, {}, 'a name'),
        h(Stage, {}, h(Chip, { mod: '2' }, 'task')),
      ),
      h(
        Figure,
        {},
        h(Caption, {}, 'a press, and a line of words beside it'),
        h(
          Stage,
          {},
          h(Button, { type: 'button' }, 'save'),
          ' Keep what was typed.',
        ),
      ),
    ),
  ],
]
