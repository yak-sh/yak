/**
 * The top of a page: its `Title` line (the words, then the thing's `Id` and
 * `Kind`, and anything else the line offers, a button say), a `Sub` saying
 * what it is (`Sub-refused`: why the last change to it was turned down), and
 * `Facts`, the short things known about it, kept apart by a dot. A `Title`
 * given an `href` is a link to the page, for a head drawn somewhere else
 * (el.ts).
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h, toChildArray } from 'preact'
import { block, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'

let Base = block('header', 'Head', {
  Eyebrow: 'p',
  Period: 'p',
  Address: 'a',
  Title: 'h1',
  Link: 'a',
  Id: 'span',
  Kind: 'span',
  Sub: 'p',
  Facts: 'div',
  Sep: 'span',
})

let { Facts: Line, Sep } = Base

/** A page's head. */
export let Head:
  & Part
  & Record<
    | 'Title'
    | 'Link'
    | 'Id'
    | 'Kind'
    | 'Sub'
    | 'Facts'
    | 'Eyebrow'
    | 'Period'
    | 'Address',
    Part
  > = Object
    .assign(
      Base,
      {
        Facts: ({ children, ...p }: Props) =>
          h(
            Line,
            p,
            toChildArray(children).flatMap((kid, i) =>
              i ? [h(Sep, { key: `sep${i}` }, '·'), kid] : [kid]
            ),
          ),
      },
    )

/** What it is, in a line. */
export let description =
  'The top of a page: its title, what it is, and what is known of it.'

/** A blank line after it; the title ink, what it is muted and folded to the
 * width, and so are its id, kind and facts. */
export let sheet = (c: Colors): Sheet => ({
  Head: { gap: true },
  Head_Title: { fg: c.text, spaced: true },
  Head_Id: { fg: c.muted, bold: false },
  Head_Kind: { fg: c.muted, bold: false },
  Head_Sub: { fg: c.muted, wrap: true },
  'Head_Sub-refused': { fg: c.negative },
  Head_Facts: { fg: c.muted, spaced: true },
  Head_Sep: { fg: c.dim },
})

let { Title, Id, Kind, Sub, Facts } = Head

/** A whole head, and a bare one. */
export let specimens = (): Specimen[] => [
  [
    'Head, variants',
    h(
      Head,
      {},
      h(Head.Eyebrow, {}, 'Your workspace'),
      h(Head.Title, { as: 'h2', mod: 'page' }, 'Overview'),
      h(Head.Period, {}, 'Last 30 days'),
      h(Head.Address, { href: '#' }, 'example.com'),
    ),
  ],
  [
    'Head, Title, Id, Kind, Sub, Facts',
    h(
      Head,
      {},
      h(
        Title,
        { as: 'h2' },
        'task',
        h(Id, {}, '#3cc275b704'),
        h(Kind, {}, 'component'),
        h(Button, { type: 'button', mod: 'quiet' }, 'note'),
      ),
      h(Sub, {}, 'a thing to do'),
      h(
        Facts,
        {},
        h('a', { href: '#' }, '@yaks/task'),
        h('span', {}, 'kind'),
        h('span', {}, 'prefix T'),
      ),
    ),
  ],
  [
    'Head, Title, Link',
    h(Head, {}, h(Title, { as: 'h2' }, h(Head.Link, { href: '#' }, 'inspect'))),
  ],
  [
    'Head, Sub-refused',
    h(
      Head,
      {},
      h(Title, { as: 'h2' }, 'Fix the map'),
      h(Sub, { mod: 'refused' }, "no entity 'T-404'"),
    ),
  ],
]
