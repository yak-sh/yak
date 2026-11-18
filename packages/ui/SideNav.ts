/**
 * A column of links to one place's pages, beside the page they open: a
 * `SideNav.Link` each, the page you are on wearing `Link-on` (and, the
 * caller's, `aria-current="page"`), and a `SideNav.Rule` between groups of
 * them. A link's words are its `SideNav.Label`, beside its icon. `SideNav-rail`
 * is the column collapsed to its icons: each label is still the link's
 * accessible text, only not shown, and the caller gives each link its label
 * as a `title` too, its tooltip. Where there is no room beside the page (a
 * phone) the column is a row that wraps, its words shown, rail or not.
 * `SideNav.Edge` holds a whole sidebar when its edge must run past the
 * links; its navs share that edge.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
// @ts-types="./lucide.d.ts"
import grid from 'lucide/dist/esm/icons/layout-grid.mjs'
// @ts-types="./lucide.d.ts"
import users from 'lucide/dist/esm/icons/users.mjs'
// @ts-types="./lucide.d.ts"
import receipt from 'lucide/dist/esm/icons/receipt.mjs'
import { block, type Part } from './el.ts'
import { Icon } from './Icon.ts'
import type { Colors, Specimen } from './theme.ts'

/** A side navigation. */
export let SideNav: Part & Record<'Link' | 'Label' | 'Rule' | 'Edge', Part> =
  block(
    'nav',
    'SideNav',
    { Link: 'a', Label: 'span', Rule: 'hr', Edge: 'aside' },
  )

/** What it is, in a line. */
export let description =
  "A column of links to a place's pages, the one you are on lit."

/** A link is a line of its own; the one you are on stands out. */
export let sheet = (c: Colors): Sheet => ({
  SideNav_Link: { block: true, fg: c.muted },
  'SideNav_Link-hover': { fg: c.text },
  'SideNav_Link-on': { fg: c.text, bold: true },
  SideNav_Rule: { fg: c.border2 },
})

let { Link, Label, Rule, Edge } = SideNav

/** Two groups, the page you are on in the first, one link under the
 * pointer; and a rail, the column collapsed to its icons. */
export let specimens = (): Specimen[] => [
  [
    'SideNav, Edge, Link, Link-on, Link-hover, Rule',
    h(
      Edge,
      {},
      h(
        SideNav,
        { 'aria-label': 'Settings' },
        h(
          Link,
          { href: '#SideNav', mod: 'on', 'aria-current': 'page' },
          'Apps',
        ),
        h(Link, { href: '#SideNav', mod: 'hover' }, 'People'),
        h(Link, { href: '#SideNav' }, 'Billing'),
        h(Rule, {}),
        h(Link, { href: '#SideNav' }, 'Profile'),
      ),
    ),
  ],
  [
    'SideNav-rail, Label',
    h(
      SideNav,
      { mod: 'rail', 'aria-label': 'Settings' },
      ...([['Apps', grid], ['People', users], ['Billing', receipt]] as const)
        .map(([label, icon], i) =>
          h(
            Link,
            {
              href: '#SideNav',
              title: label,
              mod: i == 0 && 'on',
              'aria-current': i == 0 ? 'page' : undefined,
            },
            h(Icon, { of: icon }),
            h(Label, null, label),
          )
        ),
    ),
  ],
]
