// Trades browse the same station interface while only a village can do work.
import { equal, ok, test } from '@yaks/testing'
import { assertMatch } from '@std/assert'
import { parseHTML } from 'linkedom'
import { render } from 'preact'
import { ALL, MAKING, tradesOf } from './trades.ts'
import { ledger } from './tradebook.ts'
import { seedItems } from './items_fixture.ts'
import { ITEMS } from './items.ts'
import { preview } from './trade-preview.ts'
import { pageState } from './page-state.ts'
import { station } from './station.ts'
import { recipes, serves } from './craft.ts'
import { kitOf } from './gear.ts'
import type { Sheet } from './play.ts'
import type { Job } from './work.ts'

let sheet = (): Sheet => ({
  name: 'Tester',
  xp: 0,
  lvl: 1,
  max: 50,
  bag: [{ eid: 'sword', kind: 'sword1', n: 1 }],
  worn: {},
  kit: kitOf({}),
  firsts: [],
  abilities: [],
  learned: [],
  points: 0,
  quests: [],
  unpinned: new Set(),
})
let job = (works: Parameters<typeof tradesOf>[0] = []): Job => ({
  nodes: [],
  near: null,
  bench: null,
  board: null,
  doing: null,
  trades: tradesOf(works),
  events: [],
})
let mounted = async (
  run: (p: ReturnType<typeof page>) => void | Promise<void>,
) => {
  seedItems()
  let p = page(),
    prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: p.tab.body.ownerDocument,
    configurable: true,
  })
  await p.state.ready
  try {
    await run(p)
  } finally {
    render(null, p.tab.body)
    p.state.dispose()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}
let page = () => {
  let { document, window } = parseHTML(
    '<html><body><div class=Panel_Sheet><div id=host></div></div></body></html>',
  )
  let body = document.querySelector<HTMLElement>('#host')!, open = true
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
    head: (_html: string) => {},
  }
  let state = pageState('trades-test')
  let click = (q: string, host: Element = body) => {
    ok(host.querySelector(q), `Missing ${q}`).dispatchEvent(
      new window.Event('click', { bubbles: true }),
    )
  }
  return { tab, state, click, view: ledger(tab, preview, state) }
}

test('trade selection keeps progress rows, scroll and phone back navigation', () =>
  mounted(({ tab, view, click, state }) => {
    let s = sheet(), work = job([['wood', 15], ['forge', 45]])
    view.show(s, work)
    let list = tab.body.querySelector<HTMLElement>('.Split_List')!,
      rows = [...list.querySelectorAll('[data-select]')]
    equal(rows.length, ALL.length)
    assertMatch(rows[0].textContent!, /Woodcutting.*5 \/ 30 xp.*Level 2/s)
    assertMatch(rows[4].textContent!, /Smithing.*5 \/ 50 xp.*Level 3/s)
    list.scrollTop = 85
    click('[data-select=forge]')
    equal(list.querySelector('[data-select=wood]'), rows[0])
    equal(list.scrollTop, 85)
    equal(rows[4].getAttribute('aria-current'), 'true')
    ok(tab.body.querySelector('[data-tier]'))
    equal(tab.body.querySelectorAll('[data-do]').length, 0)
    tab.close()
    view.show(s, job([['forge', 100]]))
    tab.show()
    view.show(s, job([['forge', 100]]))
    equal(list.querySelector('[data-select=forge]'), rows[4])
    assertMatch(rows[4].textContent!, /Level 4/)
    click('.Split_Back')
    view.show(s, work)
    equal(
      tab.body.querySelector('.Split')!.classList.contains('Split-picked'),
      false,
    )
    equal(state.cursor('trades'), 'forge')
  }))

test('gathering selection teaches the nodes and does not show station actions', () =>
  mounted(({ tab, view, click }) => {
    view.show(sheet(), job())
    click('[data-select=wood]')
    let detail = tab.body.querySelector('.Split_Content')!
    assertMatch(detail.textContent!, /Oak.*Oak log/s)
    equal(detail.querySelectorAll('button, [data-do]').length, 0)
  }))

for (let trade of MAKING) {
  test(`${trade}: Trades browses the bench's tiers, requirements and ranges without work`, () =>
    mounted(({ tab, view, click }) => {
      let s = sheet(),
        work = job(),
        r = Object.values(recipes()).find((r) => r.at == trade && r.tier == 1)!
      view.show(s, work)
      click(`[data-select=${trade}]`)
      let detail = tab.body.querySelector('.Split_Content')!
      ok(detail.querySelector('[data-tier="2"]'))
      click(`[data-pick=${r.makes}]`, detail)
      assertMatch(detail.textContent!, new RegExp(ITEMS[r.makes].name))
      equal(detail.querySelectorAll('.Craft_Need').length, r.needs.length)
      if (ITEMS[r.makes].slot) ok(detail.querySelector('.Craft_Ranges'))
      equal(detail.querySelectorAll('[data-do]').length, 0)
      click('[data-tier="2"]', detail)
      equal(detail.querySelectorAll(`[data-pick=${r.makes}]`).length, 0)
      equal(detail.querySelectorAll('.Craft_Need').length, 0)
      click('[data-tier="1"]', detail)
      click(`[data-pick=${r.makes}]`, detail)
      equal(detail.querySelectorAll('.Craft_Need').length, r.needs.length)
    }))
}

test('Trades exposes upgrade requirements and comparisons for carried pieces', () =>
  mounted(({ tab, view, click }) => {
    view.show(sheet(), job())
    click('[data-select=forge]')
    click('[data-tier=up]')
    click('[data-pick=sword]')
    let detail = tab.body.querySelector('.Split_Content')!
    ok(detail.querySelector('.Craft_Need'))
    assertMatch(
      detail.textContent!,
      /Now.*current → possible result.*→ .*[-–]/s,
    )
    equal(detail.querySelectorAll('[data-do]').length, 0)
  }))

for (let available of [false, true]) {
  test(`a village bench ${available ? 'dispatches eligible work' : 'refuses work when materials are short'}`, () =>
    mounted(({ tab, state, click }) => {
      let s = sheet(), work = job(), made: string[] = [], r = recipes().sword1
      if (available) {
        s.bag = r.needs.map(([what, n]) => ({
          eid: what,
          kind: serves(what, r.tier)[0],
          n,
        }))
      }
      let bench = station(tab, {
        make: (recipe) => made.push(recipe),
        upgrade: (piece) => made.push(piece),
      }, state)
      bench.open('forge', work.trades)
      bench.show(s, work)
      click('[data-pick=sword1]')
      equal(
        tab.body.querySelector<HTMLButtonElement>('[data-do=make]')!.disabled,
        !available,
      )
      click('[data-do=make]')
      equal(made, available ? ['sword1'] : [])
    }))
}
