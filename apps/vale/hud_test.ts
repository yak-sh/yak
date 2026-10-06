// A villager's own line and app link stay visible beside their quest.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { hud, type Talk, talkView } from './hud.ts'
import { GIVERS } from './quests.ts'
import { quests } from './quests/vale.ts'
import { completion, WELCOME } from './village-tasks.ts'
import { greeting } from './villagers.ts'
import { seedDesigns } from './designs_fixture.ts'
import { drawn } from './dom_fixture.ts'

let talked = (t: Talk) => drawn(talkView(t))

seedDesigns()

test('Pip reacts to this hero marking the welcome task in Village Tasks', async () => {
  let quest = quests.find((q) => q.giver == 'pip')!
  let neutral = 'Still got room by the fire.'
  let panel = (line: string) =>
    talked({
      quest,
      state: 'open',
      have: 0,
      greets: line,
      name: 'Pip',
      note: line,
      link: { href: '/village-tasks/', label: 'Village Tasks' },
    })

  let rows = [{ village_done: { task: WELCOME, player: 'hero-a' } }]
  let done = (hero: string) => completion(() => Promise.resolve(rows), hero)
  let before = panel(greeting('pip', neutral, await done('hero-b')))
  assertStringIncludes(
    before.querySelector('.Talk_Body')!.textContent,
    'mark it done',
  )
  assertEquals(greeting('pip', neutral, false, false), neutral)

  let line = greeting('pip', neutral, await done('hero-a'), false)
  let document = panel(line)
  let body = document.querySelector('.Talk_Body')!
  assertStringIncludes(body.textContent, quest.title)
  assertStringIncludes(body.textContent, 'showed your mark')
  let link = document.querySelector('.Talk_Acts a')!
  assert(link)
  assertStringIncludes(link.getAttribute('href') ?? '', '/village-tasks/')
  assertEquals(greeting('pip', neutral, true, true), neutral)
  assertEquals(greeting('rowan', neutral, true), neutral)
})

test('a villager offer appears as a quest card with both choices', () => {
  let document = talked({
    offer: {
      eid: 'offer-1',
      giver: GIVERS[0],
      give: [{ kind: 'coin', n: 5 }],
      take: [{ kind: 'tusk', n: 2 }],
      state: 'open',
      ends: 0,
      steps: [{ kind: 'tusk', n: 2, have: 0, deed: false }],
      ready: false,
    },
    name: GIVERS[0].name,
  })
  let body = document.querySelector('.Talk_Body')!.textContent
  assertStringIncludes(body, 'Bring 2 Boar tusk')
  assertStringIncludes(body, 'Reward: 5 Coins')
  assertEquals(
    [...document.querySelectorAll('.Talk_Acts button')].map((b) =>
      b.getAttribute('data-do')
    ),
    ['accept', 'refuse', 'close'],
  )
})

test('talking to another hero offers a party invitation', () => {
  let document = talked({
    player: true,
    name: 'Ada <the Bold>',
    message: 'Travel together.',
    invite: true,
  })
  assertEquals(
    document.querySelector('.Talk_Who')!.textContent,
    'Ada <the Bold>',
  )
  assertEquals(
    [...document.querySelectorAll('.Talk_Acts button')].map((b) =>
      b.getAttribute('data-do')
    ),
    ['invite', 'close'],
  )
  assertEquals(document.querySelector('the')?.textContent, undefined)
})

test('the compass opens the map without a separate fire travel button', () => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let globals = {
    document,
    MutationObserver: window.MutationObserver,
    ResizeObserver: class {
      observe() {}
    },
    addEventListener: window.addEventListener.bind(window),
  }
  let prior = Object.keys(globals).map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  )
  for (let [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  try {
    let root = document.querySelector('main')!
    let h = hud(root, () => {}, () => false)
    assertEquals(root.querySelector('[data-tip="Travel by fire"]'), null)
    let compass = root.querySelector<HTMLButtonElement>('[data-tip="Map"]')!
    assert(compass)
    assertEquals(h.panels.map.open, false)
    compass.click()
    assertEquals(h.panels.map.open, true)
    compass.click()
    assertEquals(h.panels.map.open, false)
  } finally {
    for (let [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
