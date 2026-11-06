/**
 * A heading over a run of cards that belong together: `<Group>
 * yourname.yaks.app</Group>`, then the cards. It names what they share and
 * steps back from what they say.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { Card } from './Card.ts'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A heading over cards. */
export let Group: Part = el('h2', 'Group')

/** What it is, in a line. */
export let description = 'A heading over a run of cards that belong together.'

/** A muted line of its own. */
export let sheet = (c: Colors): Sheet => ({ Group: { fg: c.muted } })

let card = (title: string) =>
  h(Card, {}, h(Card.Head, {}, h(Card.Title, {}, title)))

/** A heading over the two cards it names. */
export let specimens = (): Specimen[] => [
  [
    'Group',
    h(
      'div',
      null,
      h(Group, {}, 'yourname.yaks.app'),
      card('Recipe Box'),
      card('Shop'),
    ),
  ],
]
