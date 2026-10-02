// Trade selection preserves the list while progress and catalog guides refresh.
import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import { parseHTML } from 'linkedom'
import { ALL, ledger, tradesOf } from './trades.ts'
import { seedItems } from './items_fixture.ts'
import { ITEMS, useItems } from './items.ts'
import { preview } from './trade-preview.ts'

let page = () => {
  let { document, window } = parseHTML(
    '<html><body><div class=Panel_Sheet><div id=host></div></div></body></html>',
  )
  let body = document.querySelector<HTMLElement>('#host')!
  let open = true
  let tab = {
    body,
    get open() {
      return open
    },
    show: () => {
      open = true
    },
    close: () => {
      open = false
    },
    toggle: () => {
      open = !open
    },
  }
  return { tab, window, view: ledger(tab) }
}

test('every trade shows name, level and xp before selection; picking keeps list identity', () => {
  seedItems()
  let { tab, window, view } = page()
  let mine = tradesOf([['wood', 15], ['forge', 45]])
  view.show(mine)
  let list = tab.body.querySelector<HTMLElement>('.Split_List')!
  let detail = tab.body.querySelector<HTMLElement>('.Split_Content')!
  let rows = [...list.querySelectorAll<HTMLElement>('[data-select]')]
  assertEquals(rows.length, ALL.length)
  assertMatch(rows[0].textContent!, /Woodcutting.*Level 2.*5 \/ 30 xp/s)
  assertMatch(rows[4].textContent!, /Smithing.*Level 3.*5 \/ 50 xp/s)
  assertEquals(list.querySelectorAll('.Bar-xp').length, ALL.length)
  list.scrollTop = 85
  rows[4].dispatchEvent(new window.Event('click', { bubbles: true }))
  assertEquals(list.querySelector('[data-select=wood]'), rows[0])
  assertEquals(list.scrollTop, 85)
  assertEquals(rows[4].getAttribute('aria-pressed'), 'true')
  assertMatch(detail.textContent!, /Forge preview/)
  assertEquals(detail.querySelectorAll('button, [data-do]').length, 0)
  let guide = detail.firstElementChild
  view.show(mine)
  assertEquals(detail.firstElementChild, guide)
  tab.close()
  view.show(tradesOf([['forge', 100]]))
  assertEquals(list.querySelector('[data-select=forge]'), rows[4])
  tab.show()
  view.show(tradesOf([['forge', 100]]))
  assertEquals(list.scrollTop, 85)
  assertMatch(
    list.querySelector('[data-select=forge]')!.textContent!,
    /Level 4/,
  )
  assertMatch(detail.textContent!, /Forge preview/)
  tab.body.querySelector('.Split_Back')!.dispatchEvent(
    new window.Event('click'),
  )
  view.show(tradesOf([['forge', 100]]))
  assertEquals(
    tab.body.querySelector('.Split')!.classList.contains('Split-picked'),
    false,
  )
})

test('gathering guide follows nodes; crafting preview follows recipes and trade eligibility', () => {
  seedItems()
  let { tab, window, view } = page()
  view.show(tradesOf([]))
  tab.body.querySelector('[data-select=wood]')!.dispatchEvent(
    new window.Event('click', { bubbles: true }),
  )
  let detail = tab.body.querySelector('.Split_Content')!
  assertMatch(detail.textContent!, /Oak.*Oak log/s)
  assertEquals(detail.querySelectorAll('button, [data-do]').length, 0)
  assertMatch(preview('cauldron', 1), /Requires level 3/)
  assertEquals(preview('cauldron', 3).includes('Requires level 3'), false)
  let sword = ITEMS.sword1
  useItems([{
    entity: { eid: 'trade-preview-sword' },
    item_design: {
      ...sword,
      kind: 'sword1',
      name: '<New sword>',
    },
  }])
  let { document } = parseHTML(preview('forge', 1))
  assertEquals(document.querySelector('b')!.textContent, '<New sword>')
  assertEquals(document.querySelector('New'), null)
  seedItems()
})
