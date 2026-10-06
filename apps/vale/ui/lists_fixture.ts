// Every list in the vale, each drawn by its own module into a panel shaped
// as the game's, with one thing picked, on one page dressed with the game's
// stylesheets as main.ts dresses it: for a browser to lay out (lists_test.ts)
// or a person to look at.
import { stylesheet } from '@yaks/ui'
import { composition } from '../ui-kit.ts'
import { withDom } from '../dom_fixture.ts'
import { seedDesigns } from '../designs_fixture.ts'
import { pageState } from '../page-state.ts'
import { type Panel, panels } from '../panel.ts'
import { SHEETS } from '../hud.ts'
import type { Sheet } from '../play.ts'
import type { Held } from '../rules.ts'
import { kitOf } from '../gear.ts'
import { tradesOf } from '../trades.ts'
import type { Job } from '../work.ts'
import type { Task } from '../journal.ts'
import type { Notice } from '../notices.ts'
import type { View } from '../deals.ts'
import type { parties } from '../party.ts'
import { memberOf } from '../party-state.ts'
import { journal } from '../journalbook.ts'
import { ledger } from '../tradebook.ts'
import { preview } from '../trade-preview.ts'
import { menu, type Settings } from '../menu.ts'
import { board } from '../board.ts'
import { pack } from '../pack.ts'
import { station } from '../station.ts'
import { partybox } from '../partybox.ts'
import { noticeboard } from '../notices.ts'
import { dealbox } from '../dealbox.ts'
import { character } from '../character.ts'
import { HAIRS, SKINS, TINTS } from '../make.ts'
import { need } from '../rules.ts'

let held = (eid: string, kind: string, more: Partial<Held> = {}): Held => ({
  eid,
  kind,
  n: 1,
  ...more,
})
let worn = {
  main: held('blade', 'sword1', { rarity: 'epic', lvl: 9 }),
  head: held('cap', 'helm1'),
}
let hero = (more: Partial<Sheet> = {}): Sheet => ({
  name: 'Wren',
  xp: 0,
  lvl: 5,
  max: 100,
  bag: [
    worn.main,
    worn.head,
    held('fine', 'sword1', { rarity: 'legendary', lvl: 5 }),
    held('heavy', 'sword2', { rarity: 'rare' }),
    held('jelly', 'jelly', { n: 4 }),
    held('tusk', 'tusk'),
  ],
  worn,
  kit: kitOf(worn),
  firsts: [],
  abilities: [],
  learned: ['brawn'],
  points: 3,
  quests: [],
  unpinned: new Set(),
  ...more,
})
let job = (): Job => ({
  nodes: [],
  near: null,
  bench: null,
  board: null,
  doing: null,
  trades: tradesOf([['wood', 15], ['forge', 45]]),
  events: [],
})
let task = (
  id: string,
  title: string,
  state: Task['state'],
  more: Partial<Task> = {},
): Task => ({
  id,
  title,
  giver: 'someone',
  from: 'Old Wren by the mill',
  level: 'mossvale',
  gives: '40 xp and a hooded cloak',
  says: 'Bring them back before the frost.',
  state,
  pinned: false,
  steps: [{
    text: 'Gather wolf pelts from the far meadow',
    have: 1,
    need: 5,
    done: false,
    level: 'mossvale',
  }],
  ...more,
})
let quests = [
  task('wolves', 'The wolves that prowl beyond the old mill', 'taken', {
    pinned: true,
  }),
  task('back', 'Home', 'taken', {
    steps: [{ text: 'Return to Wren', done: false, level: 'mossvale' }],
  }),
  task('offer', 'A lantern for the crossing', 'open'),
]
let settings = (): Settings => {
  let level = { level: 0.5, set: () => {} }
  return {
    muted: () => false,
    mute: () => {},
    music: { ...level, muted: false, toggle: () => {} },
    effects: level,
    voice: level,
    swapped: () => false,
    swap: () => {},
    hidesCursor: () => false,
    hideCursor: () => {},
    strafes: () => false,
    strafe: () => {},
    voxel: { current: 0.25, apply: () => {} },
    frames: { current: 60, set: () => {} },
  }
}
let party = {
  canJoin: true,
  invites: [{ eid: 'ask', from: 'ada' }],
  group: 'group',
  members: [
    memberOf(
      {
        entity: { eid: 'bo' },
        position: { level: 'mossvale', x: 1, z: 2, at: 1000 },
        vitals: { hp: 35, max: 80, lvl: 7 },
      },
      'Bo of the long road',
      1000,
    ),
  ],
  name: () => 'Ada',
  location: () => 'Mossvale · 12 m N',
} as unknown as ReturnType<typeof parties>
let deal = {
  eid: 'deal',
  giver: {},
  give: [{ kind: 'jelly', n: 2 }],
  take: [{ kind: 'tusk', n: 3 }],
  state: 'open',
  ends: 3_600_000,
  steps: [{ kind: 'tusk', n: 3, have: 1, deed: false }],
  ready: false,
} as unknown as View

// Each list drawn by its module into the panel the game draws it in, a tab
// of the hero's sheet or a sheet of its own, with one thing picked; `pick`
// clicks it, as a player would.
type Draw = (panel: Panel, pick: (q: string) => void) => void | Promise<void>
type Tab = keyof typeof SHEETS.hero.tabs
type Own = Exclude<keyof typeof SHEETS, 'hero'>
export let LISTS: [string, Tab | Own, Draw][] = [
  ['journal', 'journal', async (p, pick) => {
    let state = pageState()
    await state.ready
    let view = journal(p, { pin: () => {} }, state)
    view.show(quests, 'mossvale')
    pick('[data-select=wolves]')
  }],
  ['trades', 'trades', async (p, pick) => {
    let state = pageState()
    await state.ready
    ledger(p, preview, state).show(hero(), job())
    pick('[data-select=forge]')
  }],
  ...['audio', 'display', 'controls', 'keys'].map((
    section,
  ): [string, Tab, Draw] => [`menu ${section}`, 'menu', (p, pick) => {
    menu(p, settings()).show()
    pick(`[data-select=${section}]`)
  }]),
  ['skills', 'skills', (p, pick) => {
    let view = board(p, { learn: () => {}, respec: () => {} })
    let frame = { sheet: hero(), rack: true } as Parameters<
      typeof view.show
    >[0]
    view.show(frame)
    pick('[data-skill=hide]')
    view.show(frame)
  }],
  ['bag', 'bag', (p, pick) => {
    let view = pack(p, { wear: () => {}, take: () => {} })
    let frame = { sheet: hero(), rack: true }
    view.show(frame)
    pick('[data-pick="bag:heavy"]')
    view.show(frame)
  }],
  ['crafting', 'craft', async (p, pick) => {
    let state = pageState(), work = job()
    await state.ready
    let bench = station(p, { make: () => {}, upgrade: () => {} }, state)
    bench.open('forge', work.trades)
    bench.show(hero(), work)
    pick('[data-tier="1"]')
    pick('.Tile[data-pick]')
  }],
  ['upgrades', 'craft', async (p, pick) => {
    let state = pageState(), work = job()
    await state.ready
    let bench = station(p, { make: () => {}, upgrade: () => {} }, state)
    bench.open('forge', work.trades)
    bench.show(hero(), work)
    pick('[data-tier=up]')
    pick('.Tile[data-pick]')
  }],
  ['party', 'party', (p, pick) => {
    partybox(p, party, () => {}).paint({ body: { x: 0, z: 0 } } as never)
    pick('[data-select="member:bo"]')
  }],
  ['notices', 'notices', (p, pick) => {
    let board = noticeboard(p, { take: () => {} })
    board.show([
      { ...quests[2], id: 'n1', where: '40 m north' } as Notice,
      { ...quests[0], id: 'n2', where: '' } as Notice,
    ], 'mossvale')
    pick('[data-select=n1]')
  }],
  ['deals', 'deal', (p, pick) => {
    let deals = dealbox(p, () => {})
    deals.open('wren', 'Wren')
    deals.paint([deal, { ...deal, eid: 'other', ready: true }], 'wren', 0)
    pick('[data-select=deal]')
  }],
]

// Every other page of a tab, drawn the same way: one with no list in it.
export let PAGES: [string, Tab | Own, Draw][] = [
  ['character', 'character', (p) => {
    let view = character(p, {
      restyle: () => {},
      typing: () => {},
      paint: () => {},
    })
    let s = hero({ abilities: ['cleave', 'lunge'], xp: need(5) + 120 })
    view.show(s, {
      name: s.name,
      tint: TINTS[0],
      hair: HAIRS[0],
      skin: SKINS[0],
    })
  }],
]

// The game's page: the kit's stylesheet, then the game's own, as main.ts
// dresses it, and each list in its panel (panel.ts), open over a glass
// filling a window of its own.
/** The page, written to a file of its own; its path. */
export let listsPage = async (): Promise<string> => {
  seedDesigns()
  let body = await withDom(async ({ document, window }) => {
    let settle = () => new Promise((ok) => setTimeout(ok))
    for (let [name, where, draw] of [...LISTS, ...PAGES]) {
      let glass = document.createElement('div')
      glass.className = 'Case'
      glass.dataset.list = name
      document.body.append(glass)
      let state = pageState(`case-${name}`)
      await state.ready
      let shelf = panels(glass, () => false, state)
      let page: Panel = where in SHEETS.hero.tabs
        ? shelf.book('hero', SHEETS.hero)[where as Tab]
        : shelf.add(where, SHEETS[where as Own])
      page.show()
      await settle()
      let pick = (q: string) =>
        page.body.querySelector(q)!.dispatchEvent(
          new window.Event('click', { bubbles: true }),
        )
      await draw(page, pick)
      await settle()
    }
    return document.body.innerHTML
  })
  let file = await Deno.makeTempFile({ dir: '/tmp', suffix: '.html' })
  await Deno.writeTextFile(
    file,
    `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>${await stylesheet(
      composition,
    )}</style><link rel=stylesheet href="${new URL(
      './components.css',
      import.meta.url,
    )}"><style>.Case{position:relative;height:100vh;overflow:hidden}</style></head><body>${body}</body></html>`,
  )
  return file
}
