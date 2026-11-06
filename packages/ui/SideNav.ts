/**
 * A column of links to one place's pages, beside the page they open: a
 * `SideNav.Link` each, the page you are on wearing `Link-on` (and, the
 * caller's, `aria-current="page"`), and a `SideNav.Rule` between groups of
 * them. Where there is no room beside the page (a phone) the column is a row
 * that wraps.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A side navigation. */
export let SideNav: Part & Record<'Link' | 'Rule', Part> = block(
  'nav',
  'SideNav',
  { Link: 'a', Rule: 'hr' },
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

let { Link, Rule } = SideNav

/** Two groups, the page you are on in the first, one link under the
 * pointer. */
export let specimens = (): Specimen[] => [
  [
    'SideNav, Link, Link-on, Link-hover, Rule',
    h(
      SideNav,
      { 'aria-label': 'Settings' },
      h(Link, { href: '#SideNav', mod: 'on', 'aria-current': 'page' }, 'Apps'),
      h(Link, { href: '#SideNav', mod: 'hover' }, 'People'),
      h(Link, { href: '#SideNav' }, 'Billing'),
      h(Rule, {}),
      h(Link, { href: '#SideNav' }, 'Profile'),
    ),
  ],
]
