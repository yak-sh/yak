/**
 * A place to drop files on, which a press also opens the chooser from: a
 * `Drop.Zone` holding the form's own `File` input (unseen, kept in the tab
 * order, so the zone wears its focus) and what it `Say`s, its `Choose` the
 * words that read as the press, then a `Hint` of what it takes. Under it the
 * `Chosen`, an `Item` a file: its `Picture` where it is one,
 * its `Name`, its `Size` and a button that takes it back; `Item-unread` is
 * one of a kind that is not read, with a `Note` that says so. `Said` is what
 * was left out, past the input's ceilings. `Zone-over` is a zone with files
 * held over it.
 *
 * `Drop-gather` is a part that takes a drop or a paste anywhere on it (a chat
 * app's message box), whose caller draws what it holds (@yaks/ui
 * `Attachments-held`); `Drop-over` is one with files held over it. Taking
 * the drop and listing what is chosen are the caller's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'
import { Button } from './Button.ts'
import { Field } from './Field.ts'

/** A place to drop files on, and what is chosen. */
export let Drop:
  & Part
  & Record<
    | 'Zone'
    | 'File'
    | 'Say'
    | 'Choose'
    | 'Hint'
    | 'Chosen'
    | 'Item'
    | 'Picture'
    | 'Name'
    | 'Size'
    | 'Note'
    | 'Said',
    Part
  > = block('div', 'Drop', {
    Zone: 'label',
    File: 'input',
    Say: 'span',
    Choose: 'span',
    Hint: 'span',
    Chosen: 'ul',
    Item: 'li',
    Picture: 'img',
    Name: 'span',
    Size: 'span',
    Note: 'span',
    Said: 'p',
  })

/** What it is, in a line. */
export let description =
  'A place to drop files on or press to choose them, and what is chosen.'

/** The zone is a block of its own, raised while files are held over it, its
 * press in the accent; each file is a line, what describes it muted. */
export let sheet = (c: Colors): Sheet => ({
  Drop_Zone: { block: true },
  'Drop_Zone-over': { bg: c.card },
  Drop_File: { hidden: true },
  Drop_Choose: { fg: c.accent, underline: true },
  Drop_Hint: { fg: c.muted, block: true },
  Drop_Item: { block: true, spaced: true },
  Drop_Name: { fg: c.text, bold: true },
  Drop_Size: { fg: c.muted },
  Drop_Note: { fg: c.muted, block: true },
  Drop_Said: { fg: c.muted },
})

let { Zone, Chosen, Item } = Drop

// A small picture, drawn here, so the guide loads nothing.
let PICTURE = 'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4">' +
      '<rect width="4" height="4" fill="#c9a26b"/>' +
      '<circle cx="2" cy="2" r="1" fill="#6b4f2c"/></svg>',
  )

let zone = (mod?: string) =>
  h(
    Zone,
    { mod },
    h(Drop.File, { type: 'file', multiple: true }),
    h(Drop.Say, {}, h(Drop.Choose, {}, 'Choose files'), ' or drop them here'),
    h(Drop.Hint, {}, 'PDFs and pictures, up to 10 MB each'),
  )

let item = (
  name: string,
  size: string,
  { picture = false, unread = '' } = {},
) =>
  h(
    Item,
    { mod: unread && 'unread' },
    picture ? h(Drop.Picture, { src: PICTURE, alt: '' }) : null,
    h(Drop.Name, {}, name),
    h(Drop.Size, {}, size),
    unread ? h(Drop.Note, {}, unread) : null,
    h(Button, { type: 'button', 'aria-label': `Remove ${name}` }, 'Remove'),
  )

/** A zone and what was chosen through it, one held over, and a gathering
 * part, one held over. */
export let specimens = (): Specimen[] => [
  [
    'Drop, Zone, File, Say, Choose, Hint, Chosen, Item, Picture, Name, Size, ' +
    'Said, Item-unread, Note',
    h(
      Drop,
      {},
      zone(),
      h(Drop.Said, { role: 'status' }, 'Left out: film.mov, past 10 MB.'),
      h(
        Chosen,
        {},
        item('kitchen.jpg', '1.2 MB', { picture: true }),
        item('recipes.zip', '48 KB', {
          unread: "This kind of file isn't read. It is kept as it is.",
        }),
      ),
    ),
  ],
  ['Drop, Zone-over', h(Drop, {}, zone('over'))],
  [
    'Drop-gather',
    h(
      Drop,
      { mod: 'gather' },
      h(Field, { lines: true, value: '', placeholder: 'Say something…' }),
    ),
  ],
  [
    'Drop-gather, Drop-over',
    h(
      Drop,
      { mod: ['gather', 'over'] },
      h(Field, { lines: true, value: '', placeholder: 'Say something…' }),
    ),
  ],
]
