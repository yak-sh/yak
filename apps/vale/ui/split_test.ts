// Picking changes detail and paint, not list identity or scroll.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { Rows, Tile } from '@yaks/ui'
import { withDom } from '../dom_fixture.ts'
import { split } from './split.ts'

let rows = (picked?: string) =>
  h(
    Rows,
    {},
    ['a', 'b'].map((id) =>
      h(
        Tile,
        { key: id, mod: id == picked && 'on', onClick: () => {} },
        h(Tile.Title, {}, id),
      )
    ),
  )

test('selection keeps every list node and scroll; back stays on list during refresh', () =>
  withDom(
    ({ document, window }) => {
      let host = document.querySelector<HTMLElement>('#host')!
      let panes = split(host)
      let picked = () =>
        host.querySelector('.Split')!.classList.contains('Split-picked')
      panes.render(rows(), 'Choose something')
      let [first, second] = panes.list.querySelectorAll('.Tile')
      panes.list.scrollTop = 37
      panes.render(rows('b'), 'Second detail', 'b')
      let [a, b] = panes.list.querySelectorAll('.Tile')
      assertEquals([a === first, b === second], [true, true])
      assertEquals(panes.list.scrollTop, 37)
      assertEquals(
        [a, b].map((row) => row.getAttribute('aria-current')),
        ['false', 'true'],
      )
      assertEquals(panes.detail.textContent, 'Second detail')
      host.querySelector('.Split_Back')!.dispatchEvent(
        new window.Event('click'),
      )
      panes.render(rows('b'), 'Updated second detail', 'b')
      assertEquals(picked(), false)
      second.dispatchEvent(new window.Event('click', { bubbles: true }))
      panes.render(rows('b'), 'Updated second detail', 'b')
      assertEquals(picked(), true)
      assertEquals(panes.list.scrollTop, 37)
      panes.render(rows('a'), 'First detail', 'a')
      assertEquals(picked(), true)
      assertEquals(panes.list.querySelector('.Tile') === first, true)
    },
    '<html><body><div class=Panel_Sheet><div id=host></div></div></body></html>',
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
