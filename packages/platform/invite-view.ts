/**
 * The Invite page (Your account), drawn from the person's invite
 * (./account-rows.ts `invitePage`) and their spaces (./side-rows.ts): their
 * own link, to copy or share with a friend who is not in the room, and their
 * own QR code, shown to a friend on their phone, so it is large. Scanning it
 * opens a text to yaks.app with the words written, or, under Email, a letter
 * to the sign-up address; sending is signing up, so what sending agrees to is
 * said beside the code, where the friend reads it. The two ways are radios,
 * which switch with no script. Under them, how many signed up and built,
 * which moves as they do. The server draws it for the first paint, and the
 * browser draws it again as the rows move (./invite-browser.ts), showing the
 * copy button and, where the browser can share, the share button.
 *
 * @module
 */
import { createElement as h, type ReactNode as Kids } from 'react'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { TabSet } from '@yaks/ui/Tabs'
import type { Invitation } from './account-rows.ts'
import { url } from './host.ts'
import { copyable, heading } from './page-parts.ts'
import { STARTER } from './plans.ts'
import { qr } from './qr.ts'
import type { Picked } from './side-rows.ts'

/** What the Invite page says about itself beside the rows: whose it is and
 * the zone yaks.app answers under. */
export type InviteView = { person: string; apex: string }

/** The Invite page: the person's `invite`, and the space of their own that
 * each friend's free month goes to, from their `spaces`. */
export let inviteView = (
  view: InviteView,
  invite: Invitation,
  spaces: Picked[],
): Kids[] => {
  let own = spaces.find((s) => s.own)
  let space = own ? own.title || own.slug : 'your space'
  let env = { APEX: view.apex }
  let terms = [
    h('a', { href: url(env, '/terms') }, 'Terms'),
    ' · ',
    h('a', { href: url(env, '/privacy') }, 'Privacy'),
  ]
  let ways = [
    ...invite.text
      ? [{
        key: 'text',
        tab: 'Text',
        link: invite.text,
        label: 'QR code that opens a text to sign up for yaks.app',
        agree: 'Sending it signs you up for yaks.app and agrees to texts ' +
          "from yaks.app: your Operator's answers, and its alerts about " +
          'your space and the apps you build. Message frequency varies. Msg & data rates may apply. Reply STOP to ' +
          'stop, HELP for help. US numbers only.',
      }]
      : [],
    {
      key: 'email',
      tab: 'Email',
      link: invite.mail,
      label: 'QR code that opens an email to sign up for yaks.app',
      agree:
        `Sending it to ${invite.address} signs you up for yaks.app, and the answer comes by email.`,
    },
  ]
  return [
    h(
      'p',
      { className: 'Invite_Head' },
      `Send a friend your link, or show them your code. They get their own space, free, with $${STARTER} of building credit.`,
    ),
    h(
      Card,
      { className: 'Invite_Link' },
      heading('Your link'),
      copyable(invite.link, 'your invite link'),
      h(Button, {
        type: 'button',
        className: 'Invite_Share',
        hidden: true,
        'data-share': invite.link,
      }, 'Share'),
    ),
    h(
      TabSet,
      { className: 'Invite' },
      h(TabSet.Legend, null, 'Sign up by'),
      ways.map((w, i) =>
        h(
          TabSet.Item,
          { key: w.key },
          h(TabSet.Input, {
            type: 'radio',
            name: 'way',
            id: `way-${w.key}`,
            value: w.key,
            checked: !i,
          }),
          h(TabSet.Tab, { for: `way-${w.key}` }, w.tab),
          h(
            TabSet.Panel,
            { as: Card, className: 'Invite_Way' },
            h(
              'p',
              { className: 'Invite_Lead' },
              'Scan to sign up for yaks.app',
            ),
            h('a', {
              className: 'Invite_Code',
              href: w.link,
              dangerouslySetInnerHTML: { __html: qr(w.link, w.label) },
            }),
            h('p', { className: 'Invite_Words' }, invite.said),
            h('p', { className: 'Note' }, `${w.agree} `, terms),
          ),
        )
      ),
    ),
    h(
      Card,
      null,
      heading('A free month for each friend'),
      h(
        'p',
        null,
        `Each friend who signs up and builds their first app gives ${space} one more free month of the Plus plan.`,
        invite.joined
          ? ` ${invite.joined} ${
            invite.joined == 1 ? 'person has' : 'people have'
          } signed up with your invite so far, and ${invite.built} built an app.`
          : '',
      ),
    ),
  ]
}
