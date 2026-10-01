// Picking changes detail and paint, not list identity or scroll.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { split } from './split.ts'

test('selection keeps every list node and scroll; back stays on list during refresh', () => {
  let { document, window } = parseHTML(
    '<html><body><div class=Panel_Sheet><div id=host></div></div></body></html>',
  )
  let host = document.querySelector<HTMLElement>('#host')!
  let panes = split(host)
  let rows =
    '<button data-pick=a>First</button><button class="Pack_Tile" data-pick=b>Second</button>'
  panes.render(rows, 'Choose something')
  let first = panes.list.firstElementChild
  let second = panes.list.lastElementChild
  panes.list.scrollTop = 37
  panes.render(
    rows.replace('Pack_Tile"', 'Pack_Tile Pack_Tile-on"'),
    'Second detail',
    'b',
  )
  assertEquals(panes.list.firstElementChild === first, true)
  assertEquals(panes.list.lastElementChild === second, true)
  assertEquals(panes.list.scrollTop, 37)
  assertEquals(second?.getAttribute('aria-pressed'), 'true')
  assertEquals(panes.detail.textContent, 'Second detail')
  host.querySelector('.Split_Back')!.dispatchEvent(new window.Event('click'))
  panes.render(rows, 'Updated second detail', 'b')
  assertEquals(
    host.querySelector('.Split')!.classList.contains('Split-picked'),
    false,
  )
  second!.dispatchEvent(new window.Event('click', { bubbles: true }))
  panes.render(rows, 'Updated second detail', 'b')
  assertEquals(
    host.querySelector('.Split')!.classList.contains('Split-picked'),
    true,
  )
  assertEquals(panes.list.scrollTop, 37)
  panes.render(rows, 'First detail', 'a')
  assertEquals(
    host.querySelector('.Split')!.classList.contains('Split-picked'),
    true,
  )
  assertEquals(panes.list.firstElementChild === first, true)
})
