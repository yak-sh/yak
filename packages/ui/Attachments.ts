/** Pictures and files, each linking to its original. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, el, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'
import { Drop } from './Drop.ts'

let Link = el('a', 'Attachments_Link')

/** Pictures and files, each linking to its original. */
export let Attachments:
  & Part
  & Record<'Link' | 'Picture' | 'Image' | 'File', Part> = block(
    'div',
    'Attachments',
    { Link: 'a', Picture: Link, Image: 'img', File: Link },
  )
/** What this part presents. */
export let description = 'Pictures and files, each linking to its original.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Attachments: { row: true, spaced: true },
  Attachments_File: { fg: c.link },
  Attachments_Image: { hidden: true },
})
/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Attachments, variants',
    h(
      Attachments,
      {},
      h(
        Attachments.Picture,
        { href: '#' },
        h(Attachments.Image, {
          alt: 'Attached image',
          src:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2250%22/%3E',
        }),
      ),
      h(Attachments.Link, { href: '#' }, 'Download'),
    ),
  ],
  [
    'Attachments',
    h(
      Attachments,
      {},
      h(
        Attachments.File,
        { href: '#' },
        h(Drop.Kind, {}, 'PDF'),
        h(Drop.Name, {}, 'notes.pdf'),
      ),
    ),
  ],
]

/** The same interface on a native host. */
export let native = (c: Colors): Native => ({
  Attachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  Attachments_File: { color: c.link },
})
