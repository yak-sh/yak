/**
 * A pending read, distinct from an answer with no rows: `<Loading>` says
 * so, and a `Loading.Mark` before its words shows something at work (an
 * animation, a mascot) where the page has one. The words are what a screen
 * reader reads, so the mark is decoration.
 *
 * @module
 */
import { createElement as h, type FunctionComponent } from 'react'
import type { Sheet } from '@yaks/tui/theme'
import { Dot } from './Dot.ts'
import { el, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

let Frame = el('div', 'Loading')
let Mark = el('span', 'Loading_Mark')
let Image = el('img', 'Loading_Image')
let Words = el('span', 'Loading_Words')

type Pending = Props & {
  /** A diagnostic name for this read. False for specimens and write feedback. */
  state?: string | false
}

let Say = (
  { state = 'page content', children = 'Loading…', ...props }: Pending,
) =>
  h(Frame, {
    role: 'status',
    'aria-live': 'polite',
    ...props,
    'data-yak-loading': state || undefined,
  }, state ? h(Words, { 'data-yak-loading-words': '' }, children) : children)

/** Announce a pending read without hiding rows already on screen. */
export let Loading: FunctionComponent<Pending> & { Mark: Part; Image: Part } =
  Object.assign(Say, {
    Mark,
    Image,
  })

export let description = 'A read is in progress, not empty.'
/** A terminal has no animation to show, so the mark takes no room. */
export let sheet = (c: Colors): Sheet => ({
  Loading: { fg: c.muted },
  Loading_Mark: { hidden: true },
})
export let specimens = (): Specimen[] => [
  ['Loading', h(Loading, { state: false })],
  ['Loading more', h(Loading, { state: false }, 'Loading more…')],
  [
    'Loading, Mark',
    h(
      Loading,
      { state: false },
      h(Mark, { 'aria-hidden': true }, h(Dot, { mod: ['pulse', 'active'] })),
      'Checking the files…',
    ),
  ],
  [
    'Loading, Mark, Image',
    h(
      Loading,
      { state: false },
      h(
        Mark,
        { 'aria-hidden': true },
        h(Image, {
          src: 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="8" fill="#a7c080"/></svg>',
          ),
          alt: '',
        }),
      ),
      'Checking the files…',
    ),
  ],
]
