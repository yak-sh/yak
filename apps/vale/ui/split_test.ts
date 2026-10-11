// Picking changes detail and paint, not list identity or scroll.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { withDom } from '../dom_fixture.ts'
import { split } from './split.ts'

let rows = (picked?: string) =>
  h(
    'div',
    {},
    ['a', 'b'].map((id) =>
      h(
        'button',
        { key: id, class: 'Tile', 'aria-current': id == picked },
        id,
      )
    ),
  )

// Mount the panes once; the test exercises only selection and refresh.
let dom = parseHTML(
  '<html><body><div class=Panel_Sheet><div id=host></div></div></body></html>',
)
let host = dom.document.querySelector<HTMLElement>('#host')!
let draws = [rows('b'), rows('b'), rows('b'), rows('a')]
let [first, second, a, b, panes] = withDom(() => {
  let panes = split(host)
  panes.render(rows(), 'Choose something')
  let [first, second] = panes.list.querySelectorAll('.Tile')
  panes.list.scrollTop = 37
  panes.render(draws[0], 'Second detail', 'b')
  let [a, b] = panes.list.querySelectorAll('.Tile')
  return [first, second, a, b, panes] as const
}, dom)
let root = host.querySelector('.Split')!
let back = host.querySelector('.Split_Back')!

test('selection keeps every list node and scroll; back stays on list during refresh', () =>
  withDom(
    ({ window }) => {
      let picked = () => root.classList.contains('Split-picked')
      assertEquals([a === first, b === second], [true, true])
      assertEquals(panes.list.scrollTop, 37)
      assertEquals(
        [a, b].map((row) => row.getAttribute('aria-current')),
        ['false', 'true'],
      )
      assertEquals(panes.detail.textContent, 'Second detail')
      back.dispatchEvent(new window.Event('click'))
      panes.render(draws[1], 'Updated second detail', 'b')
      assertEquals(picked(), false)
      second.dispatchEvent(new window.Event('click', { bubbles: true }))
      panes.render(draws[2], 'Updated second detail', 'b')
      assertEquals(picked(), true)
      assertEquals(panes.list.scrollTop, 37)
      panes.render(draws[3], 'First detail', 'a')
      assertEquals(picked(), true)
      assertEquals(panes.list.querySelector('.Tile') === first, true)
      render(null, panes.list)
    },
    dom,
  ))

test('a list drawn as markup gives way to rows and back', () =>
  withDom(({ document }) => {
    let panes = split(document.querySelector<HTMLElement>('main')!)
    panes.render('<p>Sign in first.</p>', '')
    panes.render(rows('a'), '')
    assertEquals(panes.list.textContent, 'ab')
    panes.render('<p>Sign in first.</p>', '')
    panes.render(rows('b'), '')
    assertEquals(
      [...panes.list.querySelectorAll('.Tile')].map((row) =>
        row.getAttribute('aria-current')
      ),
      ['false', 'true'],
    )
  }))
