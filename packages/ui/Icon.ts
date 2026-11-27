/**
 * A glyph drawn in lines, as tall as the words beside it and in their
 * colour: `<Icon of={plug} />` draws a Lucide icon's nodes. An icon says
 * nothing to a screen reader; the words beside it say what it means. A
 * terminal has no lines to draw it in, so it paints nothing there.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { createElement as h, type FunctionComponent } from 'react'
import type { IconNode } from 'lucide'
// @ts-types="./lucide.d.ts"
import plug from 'lucide/dist/esm/icons/plug.mjs'
// @ts-types="./lucide.d.ts"
import bot from 'lucide/dist/esm/icons/bot.mjs'
import { el, type Props } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'

let Svg = el('svg', 'Icon')

/** What an icon is drawn from: its nodes, and anything a part takes. */
export type IconProps = Props & { of: IconNode }

/** Discord's controller mark in the kit's outline style. */
export let discord: IconNode = [
  ['path', {
    d: 'M9 5.5 8 4.5c-1.5.3-3 .9-4.3 1.7C2.4 8.7 1.8 12 2 15.8a16 16 0 0 0 5.4 2.7l1.2-2.2m6.8 0 1.2 2.2a16 16 0 0 0 5.4-2.7c.2-3.8-.4-7.1-1.7-9.6-1.3-.8-2.8-1.4-4.3-1.7l-1 1',
  }],
  ['path', { d: 'M7 6.5a14 14 0 0 1 10 0M6 15a13 13 0 0 0 12 0' }],
  ['path', { d: 'M9 11v.5m6-.5v.5' }],
]

/** A glyph in lines. */
export let Icon: FunctionComponent<IconProps> = ({ of, ...props }) =>
  h(
    Svg,
    {
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
      ...props,
    },
    of.map(([tag, attrs]) => h(tag, attrs as Record<string, unknown>)),
  )

/** What it is, in a line. */
export let description =
  'A glyph drawn in lines, the size and colour of its words.'

/** A terminal draws no lines. */
export let sheet = (_c: Colors): Sheet => ({
  Icon: { hidden: true },
})

/** On a phone it is drawn in lines, a little taller than its words, in
 * their colour. */
export let native = (_c: Colors): Native => ({
  Icon: {
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
})

/** An icon on its own, and one leading its words. */
export let specimens = (): Specimen[] => [
  ['Icon', h('span', null, h(Icon, { of: plug }))],
  ['Discord', h('span', null, h(Icon, { of: discord }))],
  [
    'Icon, with words',
    h('span', null, h(Icon, { of: bot }), ' Connect your agent'),
  ],
]
