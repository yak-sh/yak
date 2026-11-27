import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { createElement as h } from 'react'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import { contents } from './Contents.ts'
import { anchor, current, fill } from './contents-browser.ts'

// A page of headings, and an empty contents list filled from those `from`
// names: what each list then links to, and whether it shows.
let filled = (headings: string, from = 'h2') => {
  let { document } = parseHTML(
    `<html><body>${
      renderToString(h('div', null, contents({ from })))
    }<main>${headings}</main></body></html>`,
  )
  let nav = document.querySelector('.Contents') as HTMLElement
  fill(nav, document)
  let links = (list: Element) =>
    [...list.querySelectorAll('a')].map((a) =>
      `${a.getAttribute('href')} ${a.textContent}`
    )
  let [beside, menu] = [...nav.querySelectorAll('.Contents_List')].map(links)
  assertEquals(menu, beside)
  return { links: beside, hidden: nav.hidden }
}

test('a contents list is made from the headings it names, each with an anchor', () => {
  assertEquals(
    filled(
      '<h2 id="logo">Logo</h2><h2>General  settings</h2><h2>General settings</h2><h3>Not this</h3>',
    ),
    {
      links: [
        '#logo Logo',
        '#general-settings General settings',
        '#general-settings-2 General settings',
      ],
      hidden: false,
    },
  )
})

test('a page of fewer than three sections shows no contents', () => {
  assertEquals(filled('<h2>One</h2><h2>Two</h2>').hidden, true)
})

test('a heading in a closed fold or a dialog is not a section', () => {
  assertEquals(
    filled(
      '<h2>A</h2><details><h2>B</h2></details><dialog><h2>C</h2></dialog><h2>D</h2><h2>E</h2>',
    ).links,
    ['#a A', '#d D', '#e E'],
  )
})

test('the section in view is the last whose heading has reached the top', () => {
  let cases: [boolean[], number][] = [
    [[false, false, false], 0],
    [[true, false, false], 0],
    [[true, true, false], 1],
    [[true, true, true], 2],
  ]
  for (let [passed, at] of cases) assertEquals(current(passed), at)
})

test('an anchor is a heading’s words, lower case and hyphenated', () => {
  assertEquals(
    ['Connected for kit.yaks.app', 'Café & más', '—'].map(anchor),
    ['connected-for-kit-yaks-app', 'cafe-mas', 'section'],
  )
})

test('entries drawn by the server link to their anchors, the one in view lit', () => {
  let html = renderToString(
    h(
      'div',
      null,
      contents({
        on: 'b',
        entries: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', sub: true }],
      }),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  let list = document.querySelector('.Contents_List')!
  assertEquals(
    [...list.querySelectorAll('li')].map((li) => {
      let a = li.querySelector('a')!
      return [
        li.className,
        a.getAttribute('href'),
        a.className,
        a.getAttribute('aria-current'),
      ]
    }),
    [
      ['Contents_Item', '#a', 'Contents_Link', null],
      [
        'Contents_Item Contents_Item-sub',
        '#b',
        'Contents_Link Contents_Link-on',
        'location',
      ],
    ],
  )
})
