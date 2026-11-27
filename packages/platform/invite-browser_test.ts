import { equal, ok, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { createElement as h } from 'react'
import { parseHTML } from 'linkedom'
import { bindInvite, type Sharer } from './invite-browser.ts'
import { type InviteView, inviteView } from './invite-view.ts'
import { type Invitation, INVITE_PAGE, inviteRow } from './account-rows.ts'
import { type Picked, SIDE_SPACES, spaceRows } from './side-rows.ts'
import { graph } from './page-graph_fixture_test.ts'

let ADA = 'person-ada'
let view: InviteView = { person: ADA, apex: 'yaks.app' }
let said = 'Hi yaks.app, sign me up! (invite from Ada, k7q2m)'
let LINK = 'https://yaks.app/i/k7q2m'
let invite = (joined = 0, built = 0): Invitation => ({
  said,
  link: LINK,
  text: `sms:+18885550100?&body=${encodeURIComponent(said)}`,
  mail: `mailto:signup@yaks.app?body=${encodeURIComponent(said)}`,
  address: 'signup@yaks.app',
  joined,
  built,
})
let spaces = (title: string): (Picked & { eid: string })[] => [
  { eid: 'space-ada', slug: 'ada', title, owner: true, own: true },
]

// The Invite view as the server draws it, kept drawn from a graph holding
// the rows it was drawn from, in a browser that shares with `sharer`.
let bound = (sharer?: Sharer) => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'invite', 'data-invite-view': JSON.stringify(view) },
      inviteView(view, invite(), spaces('Ada’s')),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  let root = document.querySelector<HTMLElement>('[data-view]')!
  let g = graph((b) => Promise.resolve(b))
  g.set(INVITE_PAGE, [inviteRow(ADA, invite())])
  g.set(SIDE_SPACES, spaceRows(ADA, spaces('Ada’s')))
  bindInvite(root, g, sharer)
  let month = () =>
    [...root.querySelectorAll('p')].map((p) => p.textContent ?? '')
      .find((t) => t.startsWith('Each friend')) ?? ''
  return { root, g, month }
}

test('each way is a code to scan that opens the words, and what sending agrees to', () => {
  let { root } = bound()
  let codes = [...root.querySelectorAll('.Invite_Code')]
  equal(codes.map((a) => a.getAttribute('href')), [
    invite().text,
    invite().mail,
  ])
  ok(codes.every((a) => a.querySelector('svg[role=img] path')))
  equal(root.querySelector('.Invite_Words')?.textContent, said)
})

test('a friend who signs up and builds is counted at once, for the space renamed elsewhere', () => {
  let { g, month } = bound()
  ok(!month().includes('signed up'), month())
  g.set(INVITE_PAGE, [inviteRow(ADA, invite(2, 1))])
  g.set(SIDE_SPACES, spaceRows(ADA, spaces('Books')))
  ok(
    month().startsWith(
      'Each friend who signs up and builds their first app gives Books one more free month',
    ),
    month(),
  )
  ok(
    month().endsWith(
      '2 people have signed up with your invite so far, and 1 built an app.',
    ),
    month(),
  )
})

test('the link is there to copy, and to share where the browser can', async () => {
  let shared: ShareData[] = []
  let { root, g } = bound({
    share: (d) => (shared.push(d!), Promise.resolve()),
  })
  let go = () => root.querySelector<HTMLElement>('.Invite_Share')!
  equal(root.querySelector('.Invite_Link .Copy_Text')?.textContent, LINK)
  equal(root.querySelector<HTMLElement>('.Copy_Go')?.hidden, false)
  equal(go().hidden, false)
  g.set(INVITE_PAGE, [inviteRow(ADA, invite(1))])
  equal(go().hidden, false, 'still there once drawn again')
  go().click()
  await Promise.resolve()
  equal(shared.map((d) => d.url), [LINK])
  equal(bound().root.querySelector<HTMLElement>('.Invite_Share')?.hidden, true)
})

test('the way chosen stays chosen as the page is drawn again', () => {
  let { root, g } = bound()
  let email = () => root.querySelector<HTMLInputElement>('#way-email')!
  email().checked = true
  g.set(INVITE_PAGE, [inviteRow(ADA, invite(1))])
  equal(email().checked, true)
})
