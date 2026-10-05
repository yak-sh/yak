// The bag lists wearable pieces before grouped supplies, with item level
// taking priority over rarity and older pieces using their tier's first level.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { kitOf } from './gear.ts'
import { seedItems } from './items_fixture.ts'
import { carried, pack } from './pack.ts'

seedItems()

test('the bag orders gear by item level, then rarity', () => {
  let h = (eid: string, kind: string, lvl?: number, rarity?: 'legendary') => ({
    eid,
    kind,
    n: 1,
    lvl,
    rarity,
  })
  let worn = h('worn', 'sword2', 18)
  let bag = [
    h('low-fine', 'sword1', 1, 'legendary'),
    h('same-common', 'sword1', 12),
    h('same-fine', 'sword1', 12, 'legendary'),
    h('legacy', 'sword2'),
    worn,
    h('jelly-a', 'jelly'),
    { ...h('jelly-b', 'jelly'), n: 2 },
    h('tusk', 'tusk'),
  ]
  assertEquals(
    carried({ bag, worn: { main: worn } }).map(({ h, n }) => [h.eid, n]),
    [
      ['legacy', 1],
      ['same-fine', 1],
      ['same-common', 1],
      ['low-fine', 1],
      ['tusk', 1],
      ['jelly-a', 3],
    ],
  )
})

test('worn slots stay above the detail outside the scrolling bag list', () => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
  })
  try {
    let body = document.querySelector('main')!
    let actions: unknown[] = []
    let view = pack({ body, open: true, show() {}, close() {}, toggle() {} }, {
      wear: (...args) => actions.push(args),
      take() {},
    })
    let sword = { eid: 'sword', kind: 'sword1', n: 1 }
    let frame: Parameters<typeof view.show>[0] = {
      sheet: {
        worn: { main: sword },
        bag: [sword, { eid: 'spare', kind: 'sword1', n: 1 }],
        lvl: 1,
        learned: [],
        kit: kitOf({ main: sword }),
        name: 'Hero',
        xp: 0,
        max: 100,
        firsts: [],
        abilities: [],
        points: 0,
        quests: [],
        unpinned: new Set(),
      },
      rack: false,
    }
    view.show(frame)
    let list = body.querySelector<HTMLElement>('.Split_List')!
    let detail = body.querySelector('.Split_Content')!
    assert(!list.querySelector('.Pack_Worn'))
    assertEquals(detail.firstElementChild?.className, 'Pack_Worn')
    let worn = detail.querySelector<HTMLElement>('[data-pick="worn:main"]')!
    list.scrollTop = 300
    worn.click()
    view.show(frame)
    assertEquals(list.scrollTop, 300)
    assertEquals(detail.firstElementChild?.className, 'Pack_Worn')
    detail.querySelector<HTMLElement>('[data-do=off]')!.click()
    assertEquals(actions, [['main']])
  } finally {
    if (prior) Object.defineProperty(globalThis, 'Element', prior)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
})

// Drive both gestures through the same mounted pack, using the hero's admission rules.
let withPack = (
  kind: string,
  lvl: number,
  learned: string[],
  check: (p: {
    body: HTMLElement
    show: () => void
    actions: unknown[]
    window: ReturnType<typeof parseHTML>['window']
  }) => void,
) => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
  })
  try {
    let body = document.querySelector<HTMLElement>('main')!,
      actions: unknown[] = []
    let item = { eid: 'candidate', kind, n: 1 },
      worn = { main: { eid: 'worn', kind: 'dagger1', n: 1 } }
    let sheet = {
      worn,
      bag: [item],
      lvl,
      learned,
      kit: kitOf(worn),
      name: 'Hero',
      xp: 0,
      max: 100,
      firsts: [],
      abilities: [],
      points: 0,
      quests: [],
      unpinned: new Set<string>(),
    }
    let view = pack({ body, open: true, show() {}, close() {}, toggle() {} }, {
      wear: (...args) => actions.push(args),
      take: () => actions.push(['take']),
    })
    let show = () => view.show({ sheet, rack: true })
    show()
    check({ body, show, actions, window })
  } finally {
    if (prior) Object.defineProperty(globalThis, 'Element', prior)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
}

test('a click inspects and double-click equips eligible bag gear in its appropriate slot', () => {
  for (
    let [kind, lvl, learned, expected] of [
      ['sword1', 1, [], [['main', 'candidate']]],
      ['helm1', 1, [], [['head', 'candidate']]],
      ['dagger1', 1, ['twin'], [['off', 'candidate']]],
      ['sword2', 1, [], []],
      ['jelly', 1, [], []],
    ] as [string, number, string[], unknown[]][]
  ) {
    withPack(kind, lvl, learned, ({ body, show, actions, window }) => {
      let tile = body.querySelector<HTMLElement>('[data-pick="bag:candidate"]')!
      tile.click()
      show()
      assertEquals(actions, [], kind)
      // Selection must retain the row so the browser can deliver its second click.
      assertEquals(body.querySelector('[data-pick="bag:candidate"]'), tile)
      tile.dispatchEvent(new window.Event('dblclick', { bubbles: true }))
      assertEquals(actions, expected, kind)
    })
  }
})

test('unmet level requirements are visible in the bag before inspection and cannot equip', () => {
  for (
    let [kind, locked] of [['sword1', false], ['sword2', true], [
      'jelly',
      false,
    ]] as [string, boolean][]
  ) {
    withPack(kind, 1, [], ({ body, show, actions }) => {
      let tile = body.querySelector<HTMLElement>('[data-pick="bag:candidate"]')!
      assertEquals(tile.classList.contains('Pack_Tile-locked'), locked, kind)
      assertEquals(!!tile.querySelector('.Pack_Lock'), locked, kind)
      assertEquals(
        tile.getAttribute('aria-label')!.includes('Requires level'),
        locked,
        kind,
      )
      tile.click()
      show()
      assertEquals(!!body.querySelector('.Pack_Requirement'), locked, kind)
      if (locked) {
        assertEquals(body.querySelector('[data-do=wear]'), null)
        // A stale action from before a level change also respects admission.
        let stale = body.ownerDocument.createElement('button')
        stale.dataset.do = 'wear'
        body.append(stale)
        stale.click()
        assertEquals(actions, [])
      }
    })
  }
})
