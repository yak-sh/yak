import { equal, test } from '@yaks/testing'
import { askOf, connectionsPage, pageAsked } from './connections-page.ts'
import { holds } from './connections-view.ts'
import { connections, page, SPACE } from './connections_fixture_test.ts'

// What the dialog shows of `page`: its key, and the body's heading.
let dialog = (root: HTMLElement) => {
  let d = root.querySelector('dialog')!
  let body = d.querySelector('.Modal_Body:not([hidden])')
  return {
    open: d.hasAttribute('open'),
    key: d.getAttribute('data-modal-key'),
    title: body?.querySelector('h2')?.textContent ?? null,
    said: body?.querySelector('[role=status]')?.textContent ?? null,
  }
}

test('the dialog shows what the page was opened on, keeping every other body hidden in it', () => {
  let shut = page()
  equal(dialog(shut), { open: false, key: null, title: null, said: null })
  equal(shut.querySelectorAll('dialog .Modal_Body[hidden]').length, 2)
  equal(
    dialog(page(undefined, connections({ open: 'c-weather' }))).title,
    'weather',
  )
  equal(
    dialog(page(undefined, connections({ open: 'cal' }))).title,
    'Connect cal',
  )
})

test('one the page does not hold is said as gone once read for, else loading', () => {
  equal(
    dialog(page(undefined, connections({ open: 'nope' }))).said,
    'This connection is not on this page: it was removed, or it belongs to another space.',
  )
  let c = connections()
  equal([holds(c, 'weather'), holds(c, 'c-weather'), holds(c, 'cal')], [
    true,
    true,
    true,
  ])
  equal(holds(c, 'hubspot'), false)
})

test('a line names its space and what the address asks, read back whatever they hold', () => {
  let asks = [
    '',
    askOf(new URLSearchParams('?q=crm&detail=a%22b&trash=1&other=x')),
    'q=a&b=c\\d',
  ]
  for (let ask of asks) {
    equal(pageAsked(connectionsPage(SPACE, ask)), { space: SPACE, ask })
  }
  equal(asks[1], 'q=crm&detail=a%22b&trash=1')
  equal(pageAsked('.operatorSettings.space=x'), undefined)
})
