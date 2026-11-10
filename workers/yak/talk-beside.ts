// What waits on the person, beside their conversation with the Operator
// (D-153799, The chair): a column at the right of every chat page, held in
// place while the conversation scrolls, of short lists that are always
// there. On a phone, or beside an app, the column is one press away: the
// bar's button (`waitsButton`), wearing the count, opens it over the
// conversation (`#needs`). Each list is a node and how many it holds;
// another list is one more entry in the page's `lists`.
import { type ComponentChildren as Node, h } from 'preact'
import { Badge, Button, Empty, Icon, Toolbar } from '@yaks/ui/parts'
import { icons } from './icons.ts'

/** One list beside the conversation: what it draws, null where it has
 * nothing to say, and how many things in it wait on the person. */
export type List = { node: Node; count: number }

/** Where the column is, which the bar's button opens on a phone. */
export let NEEDS = 'needs'

let counted = (lists: List[]) => lists.reduce((n, l) => n + l.count, 0)

/** The bar's way to the column, with how many wait. */
export let waitsButton = (lists: List[]) => {
  let n = counted(lists)
  let said = n ? `What needs you: ${n}` : 'What needs you'
  return h(
    Button,
    { href: `#${NEEDS}`, class: 'Talk_Waits', title: said, 'aria-label': said },
    h(Icon, { of: icons.bell }),
    n ? h(Badge, null, n) : null,
  )
}

/** The column: its name and count over the lists, or that nothing needs
 * them; Close takes it away where it is opened over the conversation. */
export let talkBeside = (lists: List[]) => {
  let n = counted(lists)
  let drawn = lists.map((l) => l.node).filter((node) => node != null)
  return h(
    'aside',
    {
      class: 'Talk_Beside',
      id: NEEDS,
      'aria-labelledby': `${NEEDS}-title`,
      'data-needs': '',
    },
    h(
      Toolbar,
      { class: 'Talk_BesideBar' },
      h(
        Toolbar.Text,
        {},
        h(Toolbar.Title, { as: 'h2', id: `${NEEDS}-title` }, 'What needs you'),
      ),
      n ? h(Badge, null, n) : null,
      h(Button, { href: '#', class: 'Talk_Close' }, '✕ Close'),
    ),
    h(
      'div',
      { class: 'Talk_Lists' },
      drawn.length ? drawn : h(Empty, null, h('p', null, 'Nothing needs you.')),
    ),
  )
}
