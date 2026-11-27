/**
 * The Friends page (Your account): what the person sets about friends,
 * "Show when I'm online", saved as it changes. Their friends and messages
 * are over every page, one press away (./friends-dock-view.ts), which this
 * page opens too. The server draws it from the person's account row
 * (./account-rows.ts), and the browser draws it again as the row moves
 * (./friends-browser.ts).
 *
 * @module
 */
import { createElement as h } from 'react'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import type { Account } from './account-rows.ts'
import { PANEL } from './friends-dock-view.ts'
import { fieldsOf, heading, labeled, option, saving } from './page-parts.ts'
import { managePath } from './routes.ts'

/** What the Friends page says about itself beside the rows: whose it is. */
export type FriendsView = { person: string }

// "Show when I'm online": the person's `presence{hidden}`, the same one
// choice Profile has, saved as it changes.
export let showing = (hidden: boolean, page: 'friends' | 'profile') =>
  labeled(
    `presence-${page}`,
    'Show when I’m online',
    h(
      Field,
      { choose: true, id: `presence-${page}`, name: 'presence' },
      option('shown', 'Yes', !hidden),
      option('hidden', 'No', hidden),
    ),
    hidden
      ? 'Your friends don’t see when you’re on yaks.app, and you don’t see when they are.'
      : 'Your friends see when you’re on yaks.app or when you last were, and which of your apps they could open themselves. Nobody else does.',
  )

/** Friends (Your account): where friends are, and "Show when I'm online". */
export let friendsView = (
  _view: FriendsView,
  account: Pick<Account, 'hidden'>,
) => [
  h(
    Card,
    null,
    heading('Friends'),
    h(
      Form.Hint,
      { as: 'p' },
      'Your friends and your messages with them are on every page, under Friends.',
    ),
    h(
      'div',
      null,
      h(
        Button,
        { type: 'button', popovertarget: PANEL },
        'Open friends',
      ),
    ),
  ),
  saving(
    managePath('friends'),
    h(Card, null, fieldsOf(showing(account.hidden, 'friends'))),
  ),
]
