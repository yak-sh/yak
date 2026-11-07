/**
 * A glyph drawn in lines, as tall as the words beside it and in their
 * colour: `<Icon of={plug} />` draws a Lucide icon's nodes. An icon says
 * nothing to a screen reader; the words beside it say what it means. A
 * terminal has no lines to draw it in, so it paints nothing there.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'
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
  [
    'Icon, with words',
    h('span', null, h(Icon, { of: bot }), ' Connect your agent'),
  ],
]
