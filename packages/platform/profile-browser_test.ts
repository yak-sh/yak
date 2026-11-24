import { equal, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { WriteRefused, WriteUnknown } from '@yaks/client'
import { CallError } from '@yaks/tools/errors'
import { bindProfile } from './profile-browser.ts'
import { type Browser, type ProfileView, profileView } from './profile-view.ts'
import {
  ACCOUNT,
  type Account,
  accountRow,
  SIGNED_IN,
  signedInRows,
} from './account-rows.ts'
import { type Picked, SIDE_SPACES, spaceRows } from './side-rows.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import { graph } from './page-graph_fixture_test.ts'

let ADA = 'person-ada'
let view: ProfileView = {
  person: ADA,
  apex: 'yaks.app',
  session: 'here',
  links: [],
}
let ada: Account = { name: 'Ada', email: 'a@x', hidden: false }
let space = (slug: string, own = false): Picked & { eid: string } => ({
  eid: `space-${slug}`,
  slug,
  title: slug,
  owner: true,
  own,
})
let browser = (eid: string, agent = 'Firefox'): Browser => ({ eid, agent })
let spaces = [space('home', true), space('shop')]
let browsers = [browser('here'), browser('phone', 'Safari')]

// The Profile view as the server draws it.
let page = () => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'profile', 'data-profile-view': JSON.stringify(view) },
      profileView(view, ada, spaces, browsers),
    ),
  )
  let { document, window } = parseHTML(`<html><body>${html}</body></html>`)
  return {
    window,
    root: document.querySelector<HTMLElement>('[data-view]')!,
  }
}

// The graph holding the rows the page was drawn from, writes answered by
// `answer`.
let held = (
  answer: (b: Bundle[]) => Promise<Bundle[]> = (b) => Promise.resolve(b),
) => {
  let g = graph(answer)
  g.set(ACCOUNT, [accountRow(ADA, ada)])
  g.set(SIDE_SPACES, spaceRows(ADA, spaces))
  g.set(SIGNED_IN, signedInRows(browsers))
  return g
}

let shown = (root: HTMLElement) => ({
  name: root.querySelector<HTMLInputElement>('[name=name]')!.getAttribute(
    'value',
  ),
  first: [...root.querySelectorAll('[name=first] option')].map((o) =>
    `${o.getAttribute('value')}${o.hasAttribute('selected') ? '*' : ''}`
  ),
  browsers: [...root.querySelectorAll('[data-sign-out]')].map((f) =>
    f.getAttribute('data-sign-out')
  ),
})

let saveOf = (root: HTMLElement) =>
  root.querySelector<SavingForm>('form[data-save]')![SAVE_THROUGH]!

let body = (fields: Record<string, string>) => {
  let b = new FormData()
  for (let [k, v] of Object.entries(fields)) b.append(k, v)
  return b
}

let submit = (
  root: HTMLElement,
  window: { Event: typeof Event },
  session: string,
) =>
  root.querySelector(`[data-sign-out="${session}"]`)!.dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  )

let flush = () => new Promise((r) => setTimeout(r, 0))

test('the Profile page draws again as its rows move: a name from another tab, a space, a browser gone', () => {
  let { root } = page()
  let g = held()
  bindProfile(root, g)
  equal(shown(root), {
    name: 'Ada',
    first: ['home*', 'shop'],
    browsers: ['here', 'phone', 'all'],
  })
  g.set(ACCOUNT, [accountRow(ADA, { ...ada, name: 'Ada L' })])
  g.set(SIDE_SPACES, spaceRows(ADA, [space('home'), space('shop', true)]))
  g.set(SIGNED_IN, signedInRows([browser('here')]))
  equal(shown(root), {
    name: 'Ada L',
    first: ['home', 'shop*'],
    browsers: ['here', 'all'],
  })
})

test('until its account is in, the Profile page stays as the server drew it', () => {
  let { root } = page()
  let before = root.innerHTML
  bindProfile(root, graph((b) => Promise.resolve(b)))
  equal(root.innerHTML, before)
})

test('the Save bar writes the whole account through the page graph', async () => {
  let { root } = page()
  let g = held()
  bindProfile(root, g)
  await saveOf(root)(body({ name: 'Ada L', presence: 'hidden', first: 'shop' }))
  equal(g.wrote.map((b) => b[0].account), [
    { name: 'Ada L', email: 'a@x', hidden: true, first: 'shop' },
  ])
})

test('a save the door refuses, or never hears, is said on the bar, not reported', async () => {
  for (
    let [error, said] of [
      [
        new WriteRefused([], { error: 'arguments', message: 'Too long.' }),
        'Too long.',
      ],
      [
        new WriteUnknown([], new Error('offline')),
        'Your changes could not be saved. They are kept here. Try again.',
      ],
    ] as const
  ) {
    let { root } = page()
    bindProfile(root, held(() => Promise.reject(error)))
    let thrown = await saveOf(root)(body({ name: 'A' })).catch((e) => e)
    equal([thrown instanceof CallError, thrown.message], [true, said])
  }
})

test('a browser is signed out through the page graph, and every one leaves for sign-in', async () => {
  let { root, window } = page()
  let g = held()
  let left = 0
  bindProfile(root, g, () => left++)
  submit(root, window, 'phone')
  await flush()
  equal(left, 0)
  submit(root, window, 'all')
  await flush()
  equal(g.wrote.map((b) => b[0].signOut), [
    { session: 'phone' },
    { session: 'all' },
  ])
  equal(left, 1)
})

test('a sign-out refused says why, and stays on the page', async () => {
  let { root, window } = page()
  let left = 0
  bindProfile(
    root,
    held(() =>
      Promise.reject(
        new WriteRefused([], { error: 'access', message: 'Sign in again.' }),
      )
    ),
    () => left++,
  )
  submit(root, window, 'all')
  await flush()
  let said = root.querySelector<HTMLElement>('[data-said]')!
  equal([said.textContent, said.hidden, left], ['Sign in again.', false, 0])
})
