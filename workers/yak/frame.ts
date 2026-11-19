// The frame a signed-in page of yaks.app stands in, the Operator's chat and
// the settings pages alike: the kit's `Shell`, holding the side (sidebar.ts)
// beside the page's column and whatever panes the page sets beside that, each
// the window's height. The column is the page's bar over its body, which
// scrolls. The bar names the page and holds its tools, and its Menu opens the
// side where the window has no room for it; a page that names itself in a
// head of its own (`headed`) shows the bar only there.
//
// What differs between pages is handed in: the side's title and Back
// are its own (sidebar.ts `Sidebar`), and the panes beside are the page's.
import { type ComponentChildren as Kids, h } from 'preact'
import { Button, Icon, Shell, Skip, Toolbar } from '@yaks/ui/parts'
import { icons } from './icons.ts'
import { waitingBadge } from './sidebar.ts'

/** The layout (pages.ts `shell`) of a page drawn in the frame. */
export let FRAMED = 'Framed'

/** What opens the side where it is folded away: a phone's Menu, its icon
 * shown and its word heard, so the bar's title has the room, wearing what
 * waits in the side where it has a count, since the side's own is out of
 * sight behind it. */
let menu = (waiting?: number) =>
  h(
    Button,
    { class: 'Frame_Menu', href: '#menu', 'data-pane': '' },
    h(Icon, { of: icons.menu }),
    h('span', { class: 'Frame_MenuWord' }, 'Menu'),
    waiting != null ? waitingBadge(waiting) : null,
  )

export let frame = (at: {
  side: Kids
  title: Kids
  // whose it is, under the title
  sub: Kids
  // how many wait in the side, which Menu wears where the side is behind it
  waiting?: number
  // the bar's tools, after its title
  tools?: Kids
  // the page names itself in its own head, so the bar shows only on a phone
  headed?: boolean
  // the page lies on a sheet, a card, rather than the floor
  sheet?: boolean
  // under the bar, held with it
  under?: Kids
  content: Kids
  // panes beside the column
  beside?: Kids
  // the page's own names for the frame
  class?: string
  // where the skip link goes, and what it says
  skip?: [string, string]
}) => {
  let [to, said] = at.skip ?? ['#content', 'Skip to content']
  return [
    h(Skip, { href: to }, said),
    h(
      Shell,
      {
        mod: at.sheet && 'sheet',
        class: ['Frame', at.headed && 'Frame-headed', at.class]
          .filter(Boolean).join(' '),
      },
      at.side,
      h(
        Shell.Main,
        { class: 'Frame_Column' },
        h(
          Toolbar,
          { class: 'Frame_Bar' },
          menu(at.waiting),
          h(
            Toolbar.Text,
            {},
            h(
              Toolbar.Title,
              { as: at.headed ? 'span' : undefined, 'data-title': '' },
              at.title,
            ),
            h(Toolbar.Sub, {}, at.sub),
          ),
          at.tools,
        ),
        at.under,
        h(
          Shell.Body,
          { class: 'Frame_Body', id: 'content', tabindex: '-1' },
          at.content,
        ),
      ),
      at.beside,
    ),
  ]
}
