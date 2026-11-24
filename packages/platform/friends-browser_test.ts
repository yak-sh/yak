import { equal, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import type { Client, Watch } from '@yaks/client'
import { bindFriends } from './friends-browser.ts'
import { type FriendsView, friendsView } from './friends-view.ts'
import {
  ACCOUNT,
  accountRow,
  type Befriended,
  friendRows,
  FRIENDS,
} from './account-rows.ts'

let ADA = 'person-ada'
let view: FriendsView = { person: ADA, apex: 'yaks.app', all: false }
let friend = (name: string, seen?: Befriended['seen']): Befriended => ({
  person: `person-${name}`,
  name,
  seen,
  shared: [],
})
let online = { state: 'online' as const, spaces: [], apps: [] }

// A page graph standing in for the tab's: each line's rows, set by the test,
// and each write answered as `answer` says.
let graph = (answer: (b: Bundle[]) => Promise<Bundle[]>) => {
  let rows = new Map<string, Bundle[]>()
  let heard = new Map<string, Set<(b: Bundle[]) => void>>()
  let watch = (line: string) =>
    ({
      get value() {
        return rows.get(line) ?? []
      },
      ready: true,
      subscribe: (fn: (b: Bundle[]) => void) => {
        let all = heard.get(line) ?? new Set()
        heard.set(line, all.add(fn))
        return () => all.delete(fn)
      },
      close: () => {},
    }) as unknown as Watch
  let wrote: Bundle[][] = []
  return {
    wrote,
    set: (line: string, next: Bundle[]) => {
      rows.set(line, next)
      for (let fn of heard.get(line) ?? []) fn(next)
    },
    watch,
    mutate: (b: Bundle[]) => (wrote.push(b), answer(b)),
  } as unknown as Pick<Client, 'watch' | 'mutate'> & {
    wrote: Bundle[][]
    set: (line: string, rows: Bundle[]) => void
  }
}

// The Friends view as the server draws it from `friends`.
let page = (friends: Befriended[]) => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'friends', 'data-friends-view': JSON.stringify(view) },
      friendsView(view, friends, { hidden: false }),
    ),
  )
  let { document, window } = parseHTML(`<html><body>${html}</body></html>`)
  return {
    document,
    window,
    root: document.querySelector<HTMLElement>('[data-view]')!,
  }
}

let names = (root: Element) =>
  [...root.querySelectorAll('[data-friend]')].map((r) =>
    [
      r.querySelector('.Identity_Name')?.textContent,
      r.querySelector('[data-friend-dot]')?.hasAttribute('hidden') ? '' : '●',
    ].join('')
  )

let held = (friends: Befriended[], hidden = false) => {
  let g = graph((b) => Promise.resolve(b))
  g.set(ACCOUNT, [accountRow(ADA, { name: 'Ada', email: 'a@x', hidden })])
  g.set(FRIENDS, friendRows(ADA, friends))
  return g
}

let flush = () => new Promise((r) => setTimeout(r, 0))

test('the Friends page draws its rows again as they move, a fold held open staying open', () => {
  let { root } = page([friend('ann'), friend('bo')])
  let g = held([friend('ann'), friend('bo')])
  bindFriends(root, g)
  let bo = root.querySelector('[data-friend="person-bo"] details')!
  bo.setAttribute('open', '')
  g.set(FRIENDS, friendRows(ADA, [friend('bo', online), friend('ann')]))
  equal(names(root), ['bo●', 'ann'])
  equal(root.querySelector('[data-friend="person-bo"] details'), bo)
  equal(bo.hasAttribute('open'), true)
  g.set(FRIENDS, friendRows(ADA, [friend('ann'), friend('cy')]))
  equal(names(root), ['ann', 'cy'])
})

test('until its rows are in, the Friends page stays as the server drew it', () => {
  let { root } = page([friend('ann')])
  let before = root.innerHTML
  bindFriends(root, graph((b) => Promise.resolve(b)))
  equal(root.innerHTML, before)
})

test('a message is written through the page graph, and its form says it went', async () => {
  let { root, window } = page([friend('ann')])
  let g = held([friend('ann')])
  bindFriends(root, g)
  let form = root.querySelector<HTMLFormElement>('[data-friend-message]')!
  let say = form.querySelector<HTMLTextAreaElement>('[name=say]')!
  say.value = 'Hello'
  form.dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  )
  await flush()
  equal(
    g.wrote.map((b) => b[0].friendMessage),
    [{ to: 'person-ann', words: 'Hello' }],
  )
  equal(say.value, '')
  equal(
    form.querySelector('[data-said]')?.textContent,
    'Sent. It is in their Updates.',
  )
})

test('a friend asked who is refused says why, and keeps what was typed', async () => {
  let { root, window } = page([])
  let g = graph(() => Promise.reject(new Error('Nobody signs in with that.')))
  g.set(ACCOUNT, [
    accountRow(ADA, { name: 'Ada', email: 'a@x', hidden: false }),
  ])
  bindFriends(root, g)
  let form = root.querySelector<HTMLFormElement>('[data-friend-ask]')!
  let email = form.querySelector<HTMLInputElement>('[name=email]')!
  email.value = 'nobody@example.com'
  form.dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  )
  await flush()
  equal(g.wrote.map((b) => b[0].friendAsk), [{ email: 'nobody@example.com' }])
  equal(email.value, 'nobody@example.com')
  let said = form.querySelector<HTMLElement>('[data-said]')!
  equal([said.textContent, said.hidden], ['Nobody signs in with that.', false])
})
