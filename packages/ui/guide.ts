/**
 * The style guide: every part of the kit in every variant, on one page. It is
 * built of plain HTML the base dresses (a heading and a table for each part),
 * so a browser and a terminal show the same page: `/ui` (./routes.ts) and
 * `yak ui` (./cli.ts), which also shows each part's section on its own.
 *
 * @module
 */

import { h, type VNode } from 'preact'
import { kit } from './kit.ts'

/** One part's section, each variant a row: its name, then how it looks. */
export let Specimens = ({ name }: { name: string }): VNode =>
  h(
    'section',
    null,
    h('h2', null, name),
    h(
      'table',
      null,
      h(
        'tbody',
        null,
        kit[name].specimens().map(([label, node]) =>
          h('tr', { key: label }, h('td', null, label), h('td', null, node))
        ),
      ),
    ),
  )

/** Every part's section. */
export let Guide = (): VNode =>
  h(
    'div',
    null,
    h('h1', null, '@yaks/ui'),
    Object.keys(kit).map((name) => h(Specimens, { key: name, name })),
  )
