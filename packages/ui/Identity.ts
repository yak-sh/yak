/** An image or initial, a name and a short description. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** An image or initial, a name and a short description. */
export let Identity:
  & Part
  & Record<
    'Avatar' | 'Image' | 'Text' | 'Name' | 'Note' | 'Action' | 'Mark' | 'Add',
    Part
  > = block('div', 'Identity', {
    Avatar: 'span',
    Image: 'img',
    Text: 'span',
    Name: 'b',
    Note: 'small',
    Action: 'span',
    Mark: 'span',
    Add: 'a',
  })
/** What this part presents. */
export let description = 'An image or initial, a name and a short description.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Identity: { row: true, spaced: true },
  Identity_Text: { col: true },
  Identity_Name: { bold: true },
  Identity_Note: { fg: c.muted },
})
/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Identity, variants',
    h(
      Identity,
      {},
      h(Identity.Avatar, { mod: 'large' }, 'A'),
      h(Identity.Image, {
        alt: '',
        src:
          'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E',
      }),
      h(
        Identity.Text,
        {},
        h(Identity.Name, {}, 'Ada'),
        h(Identity.Note, {}, 'Personal'),
      ),
      h(Identity.Action, {}, '⌄'),
      h(Identity.Mark, {}, '✓'),
      h(Identity.Add, { href: '#' }, 'Add'),
    ),
  ],
  [
    'Identity',
    h(
      Identity,
      {},
      h(Identity.Avatar, {}, 'A'),
      h(
        Identity.Text,
        {},
        h(Identity.Name, {}, 'Ada'),
        h(Identity.Note, {}, 'Your workspace'),
      ),
    ),
  ],
]
