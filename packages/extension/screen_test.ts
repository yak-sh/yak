import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { screen, type State } from './screen.ts'
import { NONE } from './consent.ts'

let YAKS = {
  name: 'yaks.app',
  origin: 'https://yaks.app',
  socket: 'wss://yaks.app/manage/{space}/operator?browser=1',
  description: 'Sees <pages>.',
}

// What a person sees and can press: the popup's words, and each button's
// action with the site it names. Drawn as the file loads.
let shown = (s: Partial<State>) => {
  let { document } = parseHTML(
    `<main>${screen(YAKS, { signed: true, consent: NONE, ...s })}</main>`,
  )
  let does = [...document.querySelectorAll('[data-do]')].map((b) =>
    [b.getAttribute('data-do'), b.getAttribute('data-site')]
      .filter(Boolean).join(' ')
  )
  return { text: document.querySelector('main')?.textContent ?? '', does }
}
let OUT = shown({ signed: false })
let SPACELESS = shown({})
let ASKING = shown({
  space: 'jeff',
  link: 'connected',
  consent: { sites: ['https://a.com'], asking: 'https://b.com' },
})

test('signed out, the popup offers to sign in', () => {
  equal(OUT, {
    text: 'yaks.appSees <pages>.Sign in to yaks.app',
    does: ['signin'],
  })
})

test('signed in without a space, the popup asks which', () => {
  equal(SPACELESS.does, ['space'])
})

test('a site waiting on the person is asked about, and allowed sites can be removed', () => {
  equal(ASKING.text.includes('Connected to jeff.yaks.app.'), true)
  equal(ASKING.text.includes('Allow on b.com?'), true)
  equal(ASKING.does, [
    'allow https://b.com',
    'dismiss',
    'revoke https://a.com',
    'change',
    'signout',
  ])
})

let LENDING = shown({ space: 'jeff', lend: 'https://b.com' }).text

test('a screenshot waiting on the person says where to click', () => {
  let text = LENDING
  equal(text.includes('Your agent wants a screenshot of b.com'), true)
  equal(text.includes('click the button there'), true)
})
