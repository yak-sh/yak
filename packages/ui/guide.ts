/**
 * The style guide: every part of the kit in every variant, on one page. It is
 * built of plain HTML the base dresses (a heading and a table for each part),
 * so a browser and a terminal show the same page.
 *
 * @module
 */

import { h, type VNode } from 'preact'
import { kit } from './kit.ts'

/** Every part, each variant a row: its name, then how it looks. */
export let Guide = (): VNode =>
  h(
    'div',
    null,
    h('h1', null, '@yaks/ui'),
    Object.entries(kit).map(([name, part]) =>
      h(
        'section',
        { key: name },
        h('h2', null, name),
        h(
          'table',
          null,
          h(
            'tbody',
            null,
            part.specimens().map(([label, node]) =>
              h('tr', { key: label }, h('td', null, label), h('td', null, node))
            ),
          ),
        ),
      )
    ),
  )
