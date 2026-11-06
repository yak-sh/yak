import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { type Control, touch } from './touch.ts'

let PAGE = '<html><body>' +
  '<a href="https://shop.com/next">Next  page</a>' +
  '<form><label for="q">Email</label><input id="q" value="a@b.c">' +
  '<input type="password" aria-label="Password" value="secret">' +
  '<input type="hidden" name="token">' +
  '<select aria-label="Size"><option>S</option><option selected>M</option></select>' +
  '<button>Place order</button></form>' +
  '<div role="search"><input type="search" placeholder="Search"></div>' +
  '<button hidden>Ghost</button><p style="display: none"><a href="/x">Gone</a></p>' +
  '</body></html>'

// A fresh page and the world the extension holds its refs in.
let page = () => {
  let { document } = parseHTML(PAGE)
  let held = {}
  let at = (t: Parameters<typeof touch>[0]) => touch(t, document, held)
  return { document, at }
}
let { at } = page()
let LISTED = at({ op: 'list' }).controls
// One page for each case that changes its own.
let CLICKED = page(), TYPED = page(), ENTERED = page()
for (let p of [CLICKED, TYPED, ENTERED]) p.at({ op: 'list' })

let brief = (c: Control) => [c.ref, c.role, c.name]

test('a listing names each visible control with a ref', () => {
  equal(LISTED.map(brief), [
    ['e1', 'link', 'Next page'],
    ['e2', 'textbox', 'Email'],
    ['e3', 'textbox', 'Password'],
    ['e4', 'select', 'Size'],
    ['e5', 'button', 'Place order'],
    ['e6', 'searchbox', 'Search'],
  ])
})

test('a listing says what a control does and holds, never a password', () => {
  equal(LISTED[0].href, 'https://shop.com/next')
  equal([LISTED[1].value, LISTED[1].form], ['a@b.c', true])
  equal(LISTED[2].value, undefined)
  equal([LISTED[3].value, LISTED[3].options], ['M', ['S', 'M']])
  equal([LISTED[4].submits, LISTED[5].search], [true, true])
})

test('a ref is found while its page holds it, and only by the world that listed it', () => {
  equal(at({ op: 'find', ref: 'e5' }).controls.map(brief), [
    ['e5', 'button', 'Place order'],
  ])
  equal(at({ op: 'find', ref: 'e99' }).controls, [])
  let other = page()
  equal(other.at({ op: 'find', ref: 'e5' }).controls, [])
})

test('a click lands on its element only while it keeps its name', () => {
  let { document, at } = CLICKED
  let clicks = 0
  document.querySelector('a')!.addEventListener('click', (e: Event) => {
    e.preventDefault()
    clicks++
  })
  equal(at({ op: 'click', ref: 'e1', name: 'Next page' }).error, undefined)
  document.querySelector('a')!.textContent = 'Buy now'
  equal(
    at({ op: 'click', ref: 'e1', name: 'Next page' }).error,
    'it changed while the person was asked',
  )
  equal(clicks, 1)
})

test('typing sets a field as a person would, and a select by its words', () => {
  let { document, at } = TYPED
  let heard: string[] = []
  let email = document.querySelector('#q') as HTMLInputElement
  email.addEventListener('input', () => heard.push(email.value))
  at({ op: 'type', ref: 'e2', name: 'Email', text: 'jo@x.y' })
  at({ op: 'type', ref: 'e4', name: 'Size', text: 'S' })
  equal(heard, ['jo@x.y'])
  equal(at({ op: 'find', ref: 'e4' }).controls[0].value, 'S')
  equal(
    at({ op: 'type', ref: 'e4', name: 'Size', text: 'XL' }).error,
    'it has no option “XL”',
  )
})

test('Enter submits the field’s form, unless the page took the key', () => {
  let { document, at } = ENTERED
  let sent = 0
  let form = document.querySelector('form') as HTMLFormElement
  form.requestSubmit = () => void sent++
  let enter = { op: 'type' as const, ref: 'e2', name: 'Email', enter: true }
  at({ ...enter, text: 'a' })
  document.querySelector('#q')!.addEventListener(
    'keydown',
    (e: Event) => e.preventDefault(),
  )
  at({ ...enter, text: 'b' })
  equal(sent, 1)
})
