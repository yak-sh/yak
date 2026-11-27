/**
 * Pictures and files, each a `Picture` (an `Image`) or a `File` (its `Kind`
 * and `Name`), linking to its original when given its `href`. A `Frame`
 * shows a file of words as it is, where it is named. `Attachments-held`
 * is files held to send, not sent yet (a message box's): small, each with its
 * `Size`, a `Note` where one is needed and a `Remove` that takes it back.
 *
 * @module
 */
import type { Sheet } from '@yaks/tui/theme'
import { createElement as h } from 'react'
import { block, el, type Part } from './el.ts'
import type { Colors, Native, Specimen } from './theme.ts'
import { Button } from './Button.ts'

// A link once it is given where to; a file held has none.
let Link = el('span', 'Attachments_Link')

/** Pictures and files, each linking to its original. */
export let Attachments:
  & Part
  & Record<
    | 'Link'
    | 'Picture'
    | 'Image'
    | 'File'
    | 'Kind'
    | 'Name'
    | 'Size'
    | 'Note'
    | 'Remove'
    | 'Frame',
    Part
  > = block(
    'div',
    'Attachments',
    {
      Link: 'a',
      Picture: Link,
      Image: 'img',
      File: Link,
      Kind: 'span',
      Name: 'span',
      Size: 'span',
      Note: 'span',
      Remove: Button,
      Frame: 'iframe',
    },
  )
/** What this part presents. */
export let description = 'Pictures and files, each linking to its original.'
/** The same parts in a terminal. */
export let sheet = (c: Colors): Sheet => ({
  Attachments: { row: true, spaced: true },
  Attachments_File: { fg: c.link },
  Attachments_Image: { hidden: true },
  Attachments_Frame: { hidden: true },
  Attachments_Kind: { fg: c.muted, bold: true },
  Attachments_Name: { fg: c.text, bold: true },
  Attachments_Size: { fg: c.muted },
  Attachments_Note: { fg: c.muted, block: true },
})

// A small picture, drawn here, so the guide loads nothing.
let PICTURE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2250%22/%3E'

let remove = (name: string) =>
  h(Attachments.Remove, { type: 'button', 'aria-label': `Remove ${name}` }, '✕')

/** A complete example. */
export let specimens = (): Specimen[] => [
  [
    'Attachments, variants',
    h(
      Attachments,
      { mod: 'end' },
      h(
        Attachments.Picture,
        { href: '#' },
        h(Attachments.Image, { alt: 'Attached image', src: PICTURE }),
      ),
      h(Attachments.Link, { href: '#' }, 'Download'),
    ),
  ],
  [
    'Attachments, Kind, Name',
    h(
      Attachments,
      {},
      h(
        Attachments.File,
        { href: '#' },
        h(Attachments.Kind, {}, 'PDF'),
        h(Attachments.Name, {}, 'notes.pdf'),
      ),
    ),
  ],
  [
    'Attachments-held, Size, Note, Remove',
    h(
      Attachments,
      { mod: 'held' },
      h(
        Attachments.Picture,
        {},
        h(Attachments.Image, { alt: 'kitchen.jpg', src: PICTURE }),
        remove('kitchen.jpg'),
      ),
      h(
        Attachments.File,
        {},
        h(Attachments.Kind, {}, 'PDF'),
        h(Attachments.Name, {}, 'menu.pdf'),
        h(Attachments.Size, {}, '310 KB'),
        remove('menu.pdf'),
      ),
      h(
        Attachments.File,
        {},
        h(Attachments.Kind, {}, 'ZIP'),
        h(Attachments.Name, {}, 'recipes.zip'),
        h(Attachments.Size, {}, '48 KB'),
        h(Attachments.Note, {}, "This kind of file isn't read."),
        remove('recipes.zip'),
      ),
    ),
  ],
  [
    'Attachments, Frame',
    h(Attachments.Frame, {
      title: 'notes.txt',
      sandbox: '',
      srcdoc: wordsPage('Bring chairs.\nBring the big pot.'),
    }),
  ],
]

let escape = (text: string) =>
  text.replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!,
  )

/** A file of words as the page a `Frame` shows: the words as they are, in
 * the colors of the page around it, whose color scheme the frame inherits
 * and the page within takes as its own. */
export let wordsPage = (text: string): string =>
  `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>html{background:transparent}body{margin:0;padding:.5rem .75rem}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:.875rem/1.5 ui-monospace,monospace}</style><pre>${
    escape(text)
  }</pre>`

/** The same interface on a native host. */
export let native = (c: Colors): Native => ({
  Attachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  Attachments_File: { color: c.link },
})
