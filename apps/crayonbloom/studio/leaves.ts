/** A book's saved pages: each the sheet of paper it is, with its artwork,
 * how its drawing stands, and the scene and sentence to edit under it. */
import { h } from 'preact'
import { Button, Cards, Form, State } from '@yaks/ui/parts'
import { Sheet } from '../look/parts/Sheet.ts'
import { Tray } from '../look/parts/Tray.ts'
import type { Place } from '../pages/chrome.ts'
import { filed, Labeled, press } from './kit.ts'
import type { Book, Leaf } from './rows.ts'

type Shown = { place: Place; book: Book; page: Leaf; key?: string }

/** How a page's drawing stands: its tone, and the words for it. */
let stands = (page: Leaf): [string | undefined, string] =>
  page.page_drawing
    ? ['active', 'Drawing this page. Earlier completed artwork is kept.']
    : page.page_failed
    ? ['negative', page.page_failed.message]
    : page.artwork
    ? ['positive', 'Completed artwork saved.']
    : [undefined, 'Ready to draw.']

let Art = ({ place, book, page }: Shown) => {
  if (!page.artwork) {
    return h(Sheet.Wait, {}, 'Artwork has not been drawn yet.')
  }
  let src = filed(place, book)(page.artwork.blob)
  return page.artwork.mime == 'application/pdf'
    ? h(
      Sheet.Line,
      { as: 'object', data: src, type: 'application/pdf' },
      h('a', { href: src }, 'Open puzzle PDF'),
    )
    : h(Sheet.Line, {
      src,
      alt: `Completed artwork for page ${page.coloring_page.position}`,
    })
}

let Page = ({ place, book, page }: Shown) => {
  let id = page.entity.eid,
    { position, activity, prompt, caption } = page.coloring_page,
    [tone, said] = stands(page),
    quiet = { mod: 'quiet', 'data-page': id }
  return h(
    Sheet,
    { as: 'article' },
    h(Sheet.Art, {}, h(Art, { place, book, page })),
    h(
      Sheet.Caption,
      { as: 'header' },
      h(
        Sheet.Title,
        {},
        `Page ${position}`,
        activity && ' · ' + activity.replaceAll('_', ' '),
      ),
    ),
    h(State, { mod: tone }, said),
    h(
      Form,
      { 'data-page': id },
      h(Labeled, {
        id: id + '-prompt',
        title: 'Scene to draw',
        name: 'prompt',
        lines: true,
        defaultValue: prompt,
      }),
      h(Labeled, {
        id: id + '-caption',
        title: 'Story sentence',
        name: 'caption',
        defaultValue: caption,
      }),
      h(
        Form.Actions,
        {},
        h(Button, { type: 'submit' }, 'Save page'),
        press('retry', 'Redraw this page', quiet),
        press('up', 'Move up', quiet),
        press('down', 'Move down', quiet),
        page.artwork &&
          h(Button, {
            mod: 'quiet',
            href: place.at(
              `/studio/printable?id=${book.entity.eid}&page=${id}`,
            ),
          }, 'Free printable PDF'),
      ),
    ),
  )
}

/** A book's saved pages, in their order. */
export let Leaves = (
  { place, book, pages }: { place: Place; book: Book; pages: Leaf[] },
) =>
  h(
    Tray,
    {},
    h(Tray.Title, { as: 'h2' }, 'Your saved pages'),
    h(
      Cards,
      {},
      pages.map((page) => h(Page, { key: page.entity.eid, place, book, page })),
    ),
  )
