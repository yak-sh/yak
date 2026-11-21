// The frame a signed-in page of yaks.app stands in, the Operator's chat and
// the settings pages alike: the kit's `Shell`, holding the side (sidebar.ts)
// beside the page's column and whatever panes the page sets beside that, each
// the window's height. The column is the page's bar over its body, which
// scrolls. The bar names the page and holds its tools, and its Menu opens the
// side where the window has no room for it; a page that names itself in a
// head of its own (`headed`) shows the bar only there.
//
// A page with something to keep at its right (the conversation's helpers and
// lists) hands it in as its `aside`, and the frame holds it the same way on
// every page: a pane beside the column, so the page centers in the width left
// beside it, whose toggle at its top puts it away to a rail and the page
// centers in the whole width. Whether it is put away is the person's, kept on
// their row (`desk_aside{shut}`) as the side's fold is, so it holds on every
// page and device. Narrower than a laptop the pane is one press away: the
// bar's button opens it over the page, and Close goes back.
//
// What differs between pages is handed in: the side's title and Back
// are its own (sidebar.ts `Sidebar`), and the panes beside are the page's.
import { type ComponentChildren as Kids, h } from 'preact'
import { Button, Icon, Shell, Skip, Toolbar } from '@yaks/ui/parts'
import { managePath } from '@yaks/platform/routes'
import { icons } from './icons.ts'
import { waitingBadge } from './sidebar.ts'

/** Where the aside is, which the bar's button opens where it has no room. */
export let ASIDE = 'aside'

/** What a page keeps at its right: what it is called, what the bar's button
 * to it wears (its icon unless the page says more) and is called (its
 * `label` unless the page says), what it holds, whether the person keeps it
 * put away, and the page a press on its toggle comes back to. */
export type Aside = {
  label: string
  mark?: Kids
  said?: string
  content: Kids
  shut?: boolean
  back: string
}

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

// The toggle at the aside's top: a form that keeps the choice on the
// person's row (manage.ts), pressed without leaving the page (public/side.js);
// and where the aside is opened over the page, Close.
let toggle = (at: Aside) => {
  let said = at.shut ? 'Show the panel' : 'Hide the panel'
  return h(
    Toolbar,
    { class: 'Frame_AsideBar' },
    h(
      'form',
      {
        class: 'Frame_AsideFold',
        method: 'post',
        action: managePath('profile'),
        'data-side': '',
      },
      h('input', {
        type: 'hidden',
        name: 'aside',
        value: at.shut ? 'open' : 'shut',
      }),
      h('input', { type: 'hidden', name: 'back', value: at.back }),
      h(
        Button,
        {
          type: 'submit',
          class: 'Frame_AsideFolder',
          title: said,
          'aria-label': said,
          'aria-controls': ASIDE,
          'aria-expanded': String(!at.shut),
        },
        h(Icon, { of: icons['panel-right-close'], class: 'Frame_AsideShut' }),
        h(Icon, { of: icons['panel-right-open'], class: 'Frame_AsideUnshut' }),
      ),
    ),
    h(
      Button,
      { href: '#', class: 'Frame_AsideClose', 'data-pane': '' },
      h(Icon, { of: icons.x }),
      'Close',
    ),
  )
}

// The bar's way to the aside where it is not in sight.
let opener = (at: Aside) =>
  h(
    Button,
    {
      href: `#${ASIDE}`,
      class: 'Frame_AsideOpen',
      'data-pane': '',
      'data-aside-open': '',
      title: at.said ?? at.label,
      'aria-label': at.said ?? at.label,
    },
    at.mark ?? h(Icon, { of: icons['panel-right'] }),
  )

export let frame = (at: {
  side: Kids
  // before the title: the way back out of a page zoomed in from another
  back?: Kids
  title: Kids
  // whose it is, under the title, where the page says
  sub?: Kids
  // how many wait in the side, which Menu wears where the side is behind it
  waiting?: number
  // the bar's tools, after its title
  tools?: Kids
  // the page names itself in its own head, so the bar shows only on a phone
  headed?: boolean
  // the page lies on a sheet, a card, rather than the floor
  sheet?: boolean
  content: Kids
  // what the page keeps at its right, beside the column
  aside?: Aside
  // panes beside the column, after the aside
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
        mod: [at.sheet && 'sheet', at.aside?.shut && 'shut'],
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
          at.back,
          h(
            Toolbar.Text,
            {},
            h(
              Toolbar.Title,
              { as: at.headed ? 'span' : undefined, 'data-title': '' },
              at.title,
            ),
            at.sub ? h(Toolbar.Sub, {}, at.sub) : null,
          ),
          at.tools,
          at.aside ? opener(at.aside) : null,
        ),
        h(
          Shell.Body,
          { class: 'Frame_Body', id: 'content', tabindex: '-1' },
          at.content,
        ),
      ),
      at.aside
        ? h(
          Shell.Aside,
          { id: ASIDE, class: 'Frame_Aside', 'aria-label': at.aside.label },
          toggle(at.aside),
          h('div', { class: 'Frame_AsideBody' }, at.aside.content),
        )
        : null,
      at.beside,
    ),
  ]
}
