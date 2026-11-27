import { equal, test } from '@yaks/testing'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import { createElement as h } from 'react'
import { parseHTML } from 'linkedom'
import { graph } from './page-graph_fixture_test.ts'
import { bindFriends } from './friends-browser.ts'
import { type FriendsView, friendsView } from './friends-view.ts'
import { ACCOUNT, accountRow } from './account-rows.ts'
import { PANEL } from './friends-dock-view.ts'

let ADA = 'person-ada'
let view: FriendsView = { person: ADA }

let page = () => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'friends', 'data-friends-view': JSON.stringify(view) },
      friendsView(view, { hidden: false }),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}

let chosen = (root: Element) =>
  root.querySelector('#presence-friends option[selected]')?.textContent

test('the Friends page holds its setting as the account row moves, and opens friends', () => {
  let root = page()
  let g = graph((b) => Promise.resolve(b))
  bindFriends(root, g)
  equal(chosen(root), 'Yes')
  g.set(ACCOUNT, [
    accountRow(ADA, { name: 'Ada', email: 'a@x', hidden: true }),
  ])
  equal(chosen(root), 'No')
  equal(
    root.querySelector(`[popovertarget="${PANEL}"]`)?.textContent,
    'Open friends',
  )
})
