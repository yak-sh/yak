import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { memberOf } from './party-state.ts'
import { partybox } from './partybox.ts'
import type { parties } from './party.ts'
import type { Frame } from './play.ts'
import type { Bundle } from './net.ts'
import { seedItems } from './items_fixture.ts'
import { ITEMS } from './items.ts'

seedItems()

test('party details show live character stats and gear, then clear them when away', () => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  Object.defineProperty(globalThis, 'Element', {
    value: window.Element,
    configurable: true,
  })
  try {
    let row: Bundle = {
      entity: { eid: 'ada' },
      player: {},
      position: { level: 'mossvale', x: 12, z: 18, at: 1000 },
      vitals: { hp: 35, max: 80, lvl: 7 },
      gear: { main: 'sword1', off: 'shield1' },
      motion: { gait: 'idle' },
      fight: { foe: 'wolf' },
    }
    let members = [memberOf(row, 'Ada <hero>', 1000)]
    let party = {
      canJoin: true,
      invites: [],
      group: 'group',
      get members() {
        return members
      },
      location: () => 'Mossvale · 12 m N',
    } as unknown as ReturnType<typeof parties>
    let body = document.querySelector('main')!
    let view = partybox(
      { body, open: true, show() {}, close() {}, toggle() {}, head() {} },
      party,
      () => {},
    )
    let frame = { body: { x: 0, z: 0 } } as Frame
    view.paint(frame)
    body.querySelector<HTMLElement>('[data-select="member:ada"]')!.click()
    let detail = body.querySelector('.Split_Content')!
    let text = () => detail.textContent!
    ok(text().includes('Ada <hero>'))
    ok(text().includes('Level 7'))
    ok(text().includes('Health: 35 / 80'))
    equal(detail.querySelector('progress')?.getAttribute('value'), '35')
    ok(text().includes('In combat'))
    ok(text().includes(ITEMS.sword1.name))
    ok(text().includes(ITEMS.shield1.name))
    ok(text().includes('Head: Empty'))
    row.vitals = { hp: 0, max: 80, lvl: 7 }
    row.motion = { gait: 'down' }
    members = [memberOf(row, 'Ada <hero>', 1000)]
    view.paint(frame)
    ok(text().includes('Health: 0 / 80'))
    ok(text().includes('Fainted'))
    members = [memberOf(row, 'Ada <hero>', 20000)]
    view.paint(frame)
    equal(detail.querySelector('progress'), null)
    ok(text().includes('Live stats unavailable'))
    ok(!text().includes(ITEMS.sword1.name))
    ok(text().includes('Equipment unavailable'))
  } finally {
    if (prior) Object.defineProperty(globalThis, 'Element', prior)
    else Reflect.deleteProperty(globalThis, 'Element')
  }
})
