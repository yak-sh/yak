// A villager's own line and app link stay visible beside their quest, the
// compass opens the map, and a frame draws only what changed.
import { equal, ok, test, tick } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { JSDOM, VirtualConsole } from 'npm:jsdom@26.1.0'
import { options } from 'preact'
import { hud, type Talk, talkView } from './hud.ts'
import { GIVERS } from './quests.ts'
import { BEASTS } from './beasts.ts'
import { quests } from './quests/vale.ts'
import { completion, WELCOME } from './village-tasks.ts'
import { greeting } from './villagers.ts'
import { seedDesigns } from './designs_fixture.ts'
import { drawn } from './dom_fixture.ts'
import { journal } from './journalbook.ts'
import { ledger } from './tradebook.ts'
import { preview } from './trade-preview.ts'
import { partybox } from './partybox.ts'
import type { parties } from './party.ts'
import { memberOf } from './party-state.ts'
import { dealbox } from './dealbox.ts'
import type { View } from './deals.ts'
import { noticeboard } from './notices.ts'
import { tradesOf } from './trades.ts'
import { tasksOf, tracked } from './journal.ts'
import { kitOf } from './gear.ts'
import { maxHp } from './rules.ts'
import { HOME } from './levels.ts'
import type { Frame, Sheet } from './play.ts'

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

// The glass built into a page of its own, with the globals it reads; they
// are put back after `run`, whether it returns or throws. A signal moves an
// element's style by setting it whole, as a browser and jsdom take it.
let glass = async (
  run: (root: HTMLElement, h: ReturnType<typeof hud>) => void | Promise<void>,
) => {
  let { window } = new JSDOM('<main></main>', {
    virtualConsole: new VirtualConsole(),
  })
  let document = window.document
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
    await run(root, hud(root, () => {}, () => false))
  } finally {
    for (let [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('the compass opens the map without a separate fire travel button', () =>
  glass((root, h) => {
    assertEquals(root.querySelector('[data-tip="Travel by fire"]'), null)
    let compass = root.querySelector<HTMLButtonElement>('[data-tip="Map"]')!
    assert(compass)
    assertEquals(h.panels.map.open, false)
    compass.click()
    assertEquals(h.panels.map.open, true)
    compass.click()
    assertEquals(h.panels.map.open, false)
  }))

// A hero's frame as play.ts makes it, afresh each time, about one sheet:
// facing `facing`, `hp` well, fighting a creature `foe` well, if any.
let worn = { main: { eid: 'blade', kind: 'sword1', n: 1 } }
let sheet = {
  name: 'Wren',
  xp: 900,
  lvl: 7,
  max: maxHp(7),
  bag: [worn.main, { eid: 'jelly', kind: 'jelly', n: 4 }],
  worn,
  kit: kitOf(worn),
  firsts: [],
  abilities: [],
  learned: [],
  points: 1,
  quests: quests.slice(0, 2).map((quest, i) => ({
    quest,
    state: 'taken',
    have: i,
    pinned: i == 0,
  })),
  unpinned: new Set(),
} as unknown as Sheet
let frame = ({ hp = 80, foe = null as number | null, x = 0 } = {}) =>
  ({
    level: HOME,
    body: { x, y: 0, z: 0, yaw: 0, gait: 'walk' },
    vitals: { hp, max: sheet.max, lvl: sheet.lvl },
    down: false,
    sheet,
    foe: foe == null ? null : {
      eid: 'boar',
      beast: Object.keys(BEASTS)[0],
      lvl: 6,
      hp: foe,
      most: 120,
    },
    rack: false,
    talk: null,
    peer: null,
    statuses: [],
    events: [],
    now: 0,
  }) as unknown as Frame

// How many elements and components Preact diffed for what `run` showed.
let diffs = async (run: () => void) => {
  let n = 0, prior = options.diffed
  options.diffed = (vnode) => {
    n++
    prior?.(vnode)
  }
  try {
    run()
    await tick()
  } finally {
    options.diffed = prior
  }
  return n
}

test('a frame draws only what changed, and the bearing and health move without drawing', () =>
  glass(async (root, h) => {
    // One frame of main.ts's loop, as far as the glass goes.
    let show = (facing = 30, more = {}) => {
      let f = frame(more), tasks = tasksOf(f.sheet, [])
      h.mic('off')
      h.partyBadge(0)
      h.show(f, 2, 'day', facing, tracked(tasks, f.level), [40, -60])
      h.work(null)
    }
    let read = (q: string, a: string) => root.querySelector(q)!.getAttribute(a)
    show()
    await tick()
    equal(read('[data-orb=mic]', 'data-tip'), 'Microphone')
    equal(await diffs(() => show()), 0)
    equal(await diffs(() => show(90)), 0)
    equal(read('.ValeCompass', 'aria-label')?.startsWith('Bearing 90°'), true)
    equal(await diffs(() => show(90, { x: 30 })), 0)
    equal(await diffs(() => show(90, { hp: 41 })), 0)
    equal(read('.Vitals .ValeMeter', 'aria-valuenow'), '41')
    ok(await diffs(() => show(90, { hp: 41, foe: 100 })) > 0)
    equal(await diffs(() => show(90, { hp: 41, foe: 99.5 })), 0)
    equal(await diffs(() => show(90, { hp: 41, foe: 64 })), 0)
    equal(read('.Foe .ValeMeter', 'aria-valuenow'), '64')
  }))

// The sheets main.ts tells every frame, each opened over the glass, and
// what it is told each frame, made afresh as a frame makes it.
let trades = tradesOf([['wood', 15], ['forge', 45]])
let job = () => ({ ...work, trades })
let work = {
  nodes: [],
  near: null,
  bench: null,
  board: null,
  doing: null,
  events: [],
}
let deal = () =>
  ({
    eid: 'deal',
    giver: GIVERS[0],
    give: [{ kind: 'jelly', n: 2 }],
    take: [{ kind: 'tusk', n: 3 }],
    state: 'open',
    ends: 3_600_000,
    steps: [{ kind: 'tusk', n: 3, have: 1, deed: false }],
    ready: false,
  }) as View
let party = {
  canJoin: true,
  group: 'group',
  get invites() {
    return [{ eid: 'ask', from: 'ada' }]
  },
  get members() {
    return [memberOf(
      {
        entity: { eid: 'bo' },
        position: { level: HOME, x: 1, z: 2, at: 1000 },
        vitals: { hp: 35, max: 80, lvl: 7 },
      },
      'Bo',
      1000,
    )]
  },
  name: () => 'Ada',
  location: () => 'Mossvale · 12 m N',
} as unknown as ReturnType<typeof parties>
type Told = (h: ReturnType<typeof hud>) => () => void
let TOLD: [string, Told][] = [
  ['journal', (h) => {
    let v = journal(h.panels.journal, { pin: () => {} })
    h.panels.journal.show()
    return () => v.show(tasksOf(sheet, [deal()]), HOME)
  }],
  ['trades', (h) => {
    let v = ledger(h.panels.trades, preview)
    h.panels.trades.show()
    return () => v.show(sheet, job())
  }],
  ['party', (h) => {
    let v = partybox(h.panels.party, party, () => {})
    h.panels.party.show()
    return () => v.paint(frame())
  }],
  ['deals', (h) => {
    let v = dealbox(h.panels.deal, () => {})
    v.open(GIVERS[0].id, GIVERS[0].name)
    return () => v.paint([deal()], GIVERS[0].id, 1000)
  }],
  ['notices', (h) => {
    let v = noticeboard(h.panels.notices, { take: () => {} })
    h.panels.notices.show()
    return () =>
      v.show([{ ...tasksOf(sheet, [])[0], where: '40 m north' }], HOME)
  }],
]

test('an open sheet draws as it opens, and not again while what it shows stays', () =>
  glass(async (_, h) => {
    for (let [name, open] of TOLD) {
      let told = open(h)
      ok(await diffs(told) > 0, name)
      equal(await diffs(told), 0, name)
    }
  }))
