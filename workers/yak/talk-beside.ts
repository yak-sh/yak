// Beside the person's conversation with the Operator (D-153799, The chair):
// a column at the right of the chat page, held in place while the
// conversation scrolls, of the lists their servers offer that do not wait
// on them (what is working now, spending). What waits on them lives in
// Updates from <Operator> (operator-page.ts `updatesPage`), counted on the
// side's one bell. The column is drawn only where a list has something in
// it; on a phone, or beside an app, it is one press away: the bar's button
// (`besideButton`) opens it over the conversation (`#beside`).
import { type ComponentChildren as Node, h } from 'preact'
import { Button, Icon, Toolbar } from '@yaks/ui/parts'
import { icons } from './icons.ts'

/** Where the column is, which the bar's button opens on a phone. */
export let BESIDE = 'beside'

/** The bar's way to the column where it has no room. */
export let besideButton = () =>
  h(
    Button,
    {
      href: `#${BESIDE}`,
      class: 'Talk_BesideOpen',
      'data-pane': '',
      title: 'Your lists',
      'aria-label': 'Your lists',
    },
    h(Icon, { of: icons['panel-right'] }),
  )

/** The column: each list under its own title. It has no heading of its own,
 * which would repeat the first list's; its bar holds only Close, which takes
 * it away where it is opened over the conversation. */
export let talkBeside = (lists: Node[]) =>
  h(
    'aside',
    { class: 'Talk_Beside', id: BESIDE, 'aria-label': 'Your lists' },
    h(
      Toolbar,
      { class: 'Talk_BesideBar' },
      h(
        Button,
        { href: '#', class: 'Talk_Close', 'data-pane': '' },
        h(Icon, { of: icons.x }),
        'Close',
      ),
    ),
    h('div', { class: 'Talk_Lists' }, lists),
  )
