/**
 * An integration's name with its logo in front: `<Logo src={at}>Gmail</Logo>`.
 * `Logo.Mark` is the logo alone, for a place that sets the name apart, such as
 * a card's head (`<Logo.Mark src={at} class="Card_Mark" />`, sized by the
 * card). The logo is drawn as an image, never as markup, so an SVG runs no
 * script; one from another address loads once it scrolls near. With no `src`
 * it is a neutral mark, a plug. The logo says nothing to a screen reader: the
 * name beside it does.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'
// @ts-types="./lucide.d.ts"
import plug from 'lucide/dist/esm/icons/plug.mjs'
import { el, type Props } from './el.ts'
import { Icon } from './Icon.ts'
import type { Colors, Specimen } from './theme.ts'

let Outer = el('span', 'Logo')
let Mark_ = el('span', 'Logo_Mark')

/** What a logo is drawn from: the address of its image, none for the
 * neutral mark. */
export type LogoProps = Props & { src?: string }

/** The logo alone. */
let Mark: FunctionComponent<LogoProps> = ({ src, mod, ...props }) =>
  src
    ? h(Mark_, {
      as: 'img',
      src,
      alt: '',
      width: 24,
      height: 24,
      mod,
      ...src.startsWith('data:') ? {} : { loading: 'lazy', decoding: 'async' },
      ...props,
    })
    : h(
      Mark_,
      { mod: [mod].flat().concat('none'), 'aria-hidden': 'true', ...props },
      h(Icon, { of: plug }),
    )

/** An integration's name with its logo. */
export let Logo: FunctionComponent<LogoProps> & { Mark: typeof Mark } = Object
  .assign(
    (({ src, children, ...props }) =>
      h(Outer, props, h(Mark, { src }), children)) as FunctionComponent<
        LogoProps
      >,
    { Mark },
  )

/** What it is, in a line. */
export let description =
  "An integration's name with its logo in front, a plug where it has none."

/** A terminal draws no pictures: the name stands alone. */
export let sheet = (_c: Colors): Sheet => ({
  Logo_Mark: { hidden: true },
})

let svg = (fill: string) =>
  `data:image/svg+xml,${
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${fill}"/></svg>`,
    )
  }`

/** A name with a logo, one with none, and a logo alone. */
export let specimens = (): Specimen[] => [
  [
    'Logo',
    h('span', null, 'Send it with ', h(Logo, { src: svg('#ea4335') }, 'Gmail')),
  ],
  ['Logo, none', h(Logo, null, 'My server')],
  ['Logo.Mark', h(Logo.Mark, { src: svg('#5865f2') })],
]
