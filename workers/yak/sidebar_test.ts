// Sidebar draws the supplied navigation and selection, including form actions.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Item, Sidebar } from './sidebar.ts'

let items: Item[] = [
  { href: '/first', label: 'First', icon: 'bot' },
  { href: '/second', label: 'Second', icon: 'bell', count: 2 },
]
let drawn = (selected: string, collapsed = false) =>
  parseHTML(renderToString(h(Sidebar, {
    base: 'https://yaks.app',
    home: '/',
    label: 'Menu',
    fold: { collapsed, back: selected, rail: 'page-rail' },
    sections: [{
      id: 'places',
      label: 'Places',
      items: items.map((item) => ({
        ...item,
        current: item.href == selected,
      })),
    }],
    footer: [{
      id: 'account',
      label: 'Account',
      items: [
        { href: '/logout', label: 'Sign out', icon: 'log-out', submit: true },
      ],
    }],
  }))).document

for (let selected of items) {
  test(`sidebar follows the supplied selection: ${selected.label}`, () => {
    let document = drawn(selected.href, true)
    let current = document.querySelector('[aria-current="page"]')!
    assertEquals(current.getAttribute('href'), selected.href)
    assertEquals(
      current.querySelector('.SideNav_Label')?.textContent,
      selected.label,
    )
    for (let link of document.querySelectorAll('.SideNav_Link')) {
      assert(link.closest('.SideNav-rail'))
      assertEquals(
        link.getAttribute('title'),
        link.querySelector('.SideNav_Label')?.textContent,
      )
    }
    assertEquals(
      document.querySelector('input[name=back]')?.getAttribute('value'),
      selected.href,
    )
  })
}

test('sidebar keeps account actions outside scrolling navigation', () => {
  let document = drawn('/first')
  let form = document.querySelector('form[action="/logout"]')!
  assertEquals(form.getAttribute('method'), 'post')
  assertEquals(form.querySelector('button')?.textContent, 'Sign out')
  assertEquals(form.closest('.Sidebar_Scroll'), null)
  assert(document.querySelector('.Sidebar_Foot .SideNav_Rule'))
  assertEquals(document.querySelector('.Sidebar_Count')?.textContent, '2')
})
