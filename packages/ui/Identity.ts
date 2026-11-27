/** An image or initial, a name and a short description. @module */
import type { Sheet } from '@yaks/tui/theme'
import { createElement as h, type FunctionComponent } from 'react'
import { block, el, type Part, type Props } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

type AvatarProps = Props & { person?: string }

const TONES = ['tone-0', 'tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5']

let avatar: Part = el('span', 'Identity_Avatar')

let tone = (person: string): string => {
  let hash = 0
  for (let char of person) hash = Math.imul(hash, 31) + char.codePointAt(0)!
  return TONES[(hash >>> 0) % TONES.length]
}

let Avatar: FunctionComponent<AvatarProps> = ({ person, mod, ...props }) =>
  h(avatar, { ...props, mod: [mod].flat().concat(person && tone(person)) })

/** An image or initial, a name and a short description. */
export let Identity:
  & Part
  & { Avatar: typeof Avatar }
  & Record<
    'Image' | 'Text' | 'Name' | 'Note' | 'Action' | 'Mark' | 'Add',
    Part
  > = Object.assign(
    block('div', 'Identity', {
      Image: 'img',
      Text: 'span',
      Name: 'b',
      Note: 'small',
      Action: 'span',
      Mark: 'span',
      Add: 'a',
    }),
    { Avatar },
  )
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
      h(Identity.Avatar, { mod: 'large', person: 'ada' }, 'A'),
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
      h(Identity.Avatar, { person: 'ada' }, 'A'),
      h(
        Identity.Text,
        {},
        h(Identity.Name, {}, 'Ada'),
        h(Identity.Note, {}, 'Your workspace'),
      ),
    ),
  ],
  [
    'Avatar tones',
    h(
      'div',
      { style: 'display: flex; flex-wrap: wrap; gap: .5rem' },
      TONES.map((mod, i) =>
        h(Identity.Avatar, { key: mod, mod }, String.fromCharCode(65 + i))
      ),
    ),
  ],
]
