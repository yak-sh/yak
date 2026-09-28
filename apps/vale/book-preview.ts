// A browsable fixture for the field book. The game will use Book.css after
// the look is chosen; this page does not connect to a store or write data.
import { glyph } from './glyphs.ts'
import { tierRange } from './arms.ts'
import { ITEMS } from './items.ts'
import { icon } from './sprites.ts'

type Screen = 'bag' | 'journal' | 'craft'
type Item = {
  kind: string
  name: string
  level: number
  tier: string
  rarity: string
  stats: string[]
  changes: [string, string, string, string][]
}

let items: Item[] = [
  {
    kind: 'sword3',
    name: 'Steel Sword',
    level: 28,
    tier: 'III',
    rarity: 'Rare',
    stats: ['+27 Attack', '+4% Haste'],
    changes: [['Attack', '112', '119', '+7'], ['Haste', '8%', '12%', '+4%']],
  },
  {
    kind: 'bow2',
    name: 'Oak Bow',
    level: 18,
    tier: 'II',
    rarity: 'Uncommon',
    stats: ['+18 Attack', '+3% Speed'],
    changes: [['Attack', '112', '103', '−9'], ['Speed', '14%', '17%', '+3%']],
  },
  {
    kind: 'hammer2',
    name: 'Iron Hammer',
    level: 17,
    tier: 'II',
    rarity: 'Common',
    stats: ['+20 Attack', '+3 Armor'],
    changes: [['Attack', '112', '105', '−7'], ['Armor', '25', '28', '+3']],
  },
  {
    kind: 'staff3',
    name: 'Willow Staff',
    level: 26,
    tier: 'III',
    rarity: 'Rare',
    stats: ['+22 Attack', '+8% Spell power'],
    changes: [['Attack', '112', '114', '+2'], [
      'Spell power',
      '0%',
      '8%',
      '+8%',
    ]],
  },
  {
    kind: 'helm2',
    name: 'Iron Helm',
    level: 16,
    tier: 'II',
    rarity: 'Common',
    stats: ['+12 Health', '+4 Armor'],
    changes: [['Health', '324', '336', '+12'], ['Armor', '25', '29', '+4']],
  },
  {
    kind: 'cuirass3',
    name: 'Steel Cuirass',
    level: 27,
    tier: 'III',
    rarity: 'Rare',
    stats: ['+26 Health', '+11 Armor'],
    changes: [['Health', '324', '350', '+26'], ['Armor', '25', '36', '+11']],
  },
  {
    kind: 'greaves2',
    name: 'Iron Greaves',
    level: 15,
    tier: 'II',
    rarity: 'Common',
    stats: ['+9 Health', '+3 Armor'],
    changes: [['Health', '324', '333', '+9'], ['Armor', '25', '28', '+3']],
  },
  {
    kind: 'shield1',
    name: 'Pine Shield',
    level: 8,
    tier: 'I',
    rarity: 'Common',
    stats: ['+4 Armor'],
    changes: [['Armor', '25', '29', '+4']],
  },
  {
    kind: 'ring2',
    name: 'Iron Ring',
    level: 19,
    tier: 'II',
    rarity: 'Uncommon',
    stats: ['+7 Health', '+2% Haste'],
    changes: [['Health', '324', '331', '+7'], ['Haste', '8%', '10%', '+2%']],
  },
  {
    kind: 'sword2',
    name: 'Iron Sword',
    level: 19,
    tier: 'II',
    rarity: 'Common',
    stats: ['+20 Attack'],
    changes: [['Attack', '112', '105', '−7']],
  },
]
let bag = [
  'sword3',
  'bow2',
  'hammer2',
  'staff3',
  'helm2',
  'cuirass3',
  'greaves2',
  'shield1',
  'ring2',
  'tonic',
  'draught',
  'bark',
  'ore',
  'gem',
  'cap',
]
let worn = [
  ['Head', 'helm2'],
  ['Body', 'cuirass3'],
  ['Feet', 'greaves2'],
  ['Main Hand', 'sword2'],
  ['Off Hand', 'shield1'],
  ['Ring', 'ring2'],
]
let quests = [
  {
    title: 'The lantern road',
    from: 'Mara at the east gate',
    note: 'Find the old trail markers and relight the lamps before nightfall.',
    steps: [
      'Speak with Mara',
      'Gather 3 emberstones',
      'Light the ridge lanterns',
    ],
    done: 1,
    progress: '1 of 3 steps',
  },
  {
    title: 'A home for the bees',
    from: 'Edda in Mossvale',
    note: 'The meadow needs a safe place for its wandering bees.',
    steps: ['Collect 4 pieces of bark', 'Bring the bark to Edda'],
    done: 0,
    progress: '0 of 2 steps',
  },
  {
    title: 'The quarry bell',
    from: 'Stonekeeper Brin',
    note: 'A bell went quiet in Craghollow. See what happened there.',
    steps: ['Travel to Craghollow', 'Find the quarry bell'],
    done: 0,
    progress: '0 of 2 steps',
  },
]
let recipes = [
  {
    kind: 'sword3',
    name: 'Steel Sword',
    level: '25–36',
    tier: 'III',
    stats: ['+23–29 Attack', '+2–5% Haste'],
    needs: [['ore', 'Steel ore', '8 / 8'], ['bark', 'Heartwood', '3 / 3'], [
      'gem',
      'Blue gem',
      '1 / 1',
    ]],
  },
  {
    kind: 'cuirass3',
    name: 'Steel Cuirass',
    level: '25–36',
    tier: 'III',
    stats: ['+21–29 Health', '+9–13 Armor'],
    needs: [['ore', 'Steel ore', '12 / 8'], ['bark', 'Heartwood', '2 / 3']],
  },
  {
    kind: 'staff3',
    name: 'Willow Staff',
    level: '25–36',
    tier: 'III',
    stats: ['+19–25 Attack', '+6–10% Spell power'],
    needs: [['bark', 'Heartwood', '5 / 3'], ['gem', 'Blue gem', '1 / 1']],
  },
]
for (let n of [1, 2, 4, 5]) {
  let [low, high] = tierRange(n)
  for (let family of ['sword', 'cuirass', 'staff']) {
    let kind = `${family}${n}`
    recipes.push({
      kind,
      name: ITEMS[kind].name,
      level: `${low}–${high}`,
      tier: ['I', 'II', 'III', 'IV', 'V'][n - 1],
      stats: family == 'cuirass'
        ? [`+${n * 7}–${n * 9} Health`, `+${n * 3}–${n * 4} Armor`]
        : [`+${n * 7}–${n * 9} Attack`, `+${n}–${n + 3}% Haste`],
      needs: [['ore', 'Ore', `${n * 4} / ${n * 4}`], [
        'bark',
        'Wood',
        `${n * 2} / ${n * 2}`,
      ]],
    })
  }
}

let screen: Screen = 'bag'
let page: 'left' | 'right' = 'left'
let selected = 0
let quest = 0
let recipe = 0
let tier = 'III'
let root = document.querySelector<HTMLElement>('#book-preview')!
let image = (kind: string) => icon(kind) || '✦'
let tile = (kind: string, i: number, label = '') => {
  let item = items.find((x) => x.kind == kind)
  let on = screen == 'bag' && items[selected]?.kind == kind
  let tag = i < 0 ? 'div' : 'button'
  return `<${tag} class=Book_Tile ${
    i < 0 ? '' : `data-item="${i}" aria-pressed="${on}"`
  } aria-label="${item?.name ?? kind}">
    ${image(kind)}${item ? `<span class=Book_Tier>${item.tier}</span>` : ''}
    ${label ? `<span class=Book_Count>${label}</span>` : ''}</${tag}>`
}
let turn = (to: 'left' | 'right', text: string) =>
  `<button class=Book_Pill data-page=${to}>${text}</button>`
let turns = (where: 'left' | 'right', detail = 'Item') =>
  `<nav class=Book_MobileTurn aria-label="Book pages">${
    where == 'left' ? '<span></span>' : turn('left', '← List')
  }${
    where == 'left' ? turn('right', `${detail} details →`) : '<span></span>'
  }</nav>`
let statIcon = (stat: string) =>
  glyph(
    stat.includes('Armor')
      ? 'shield'
      : stat.includes('Health')
      ? 'health'
      : stat.includes('Haste') || stat.includes('Speed')
      ? 'speed'
      : stat.includes('Spell')
      ? 'sparkles'
      : 'strike',
  )
let stat = (s: string) =>
  `<div class=Book_Stat><span>${statIcon(s)}${s}</span></div>`

let bagPages = () => {
  let item = items[selected]
  let slots = worn.map(([name, kind]) =>
    `<div class=Book_Slot>${tile(kind, items.findIndex((x) => x.kind == kind))}
      <span class=Book_SlotLabel>${name}</span></div>`
  ).join('')
  let carried = bag.map((kind, i) =>
    tile(
      kind,
      items.findIndex((x) => x.kind == kind),
      i == 9 ? '3' : i == 12 ? '8' : '',
    )
  ).join('')
  return [
    `<h1 class=Book_Head>Equipment</h1><div class=Book_Slots>${slots}</div>
      <h2 class=Book_Head style="margin-top:1.1rem">Inventory <small class=Book_Meta>24 / 32</small></h2>
      <div class=Book_Items>${carried}</div>${turns('left', item.name)}`,
    `<div class=Book_ItemTop><div class=Book_Picture>${
      image(item.kind)
    }</div><div>
       <h1 class=Book_ItemName>${item.name}</h1><p class=Book_Level>Item level ${item.level}</p>
       <div class=Book_Badges><span class=Book_Badge>Tier ${item.tier}</span>
       <span class="Book_Badge Book_Badge-${item.rarity.toLowerCase()}">${item.rarity}</span></div></div></div>
       <div class=Book_Rule></div><h2 class=Book_Subhead>Item stats</h2>
       <div class="Book_Card Book_Stats">${item.stats.map(stat).join('')}</div>
       <h2 class=Book_Subhead>If equipped</h2><div class="Book_Card Book_Stats">${
      item.changes.map(([name, before, after, delta]) =>
        `<div class=Book_Stat><span>${statIcon(name)}${name}</span>
             <span class=Book_StatVal>${before} → ${after} <span class="Book_Change${
          delta.startsWith('−') ? ' Book_Change-down' : ''
        }">(${delta})</span></span></div>`
      ).join('')
    }</div>
       <button class=Book_Action data-preview=equip type=button>Equip</button>
       <p class=Book_PreviewResponse role=status></p>
       <p class="Book_Note Book_Foot">${
      glyph('lock')
    } Item level is the level needed to wear this piece.</p>
       ${turns('right')}`,
  ]
}
let journalPages = () => {
  let q = quests[quest]
  return [
    `<h1 class=Book_Head>Journal</h1><p class=Book_Lead>Stories found along the road.</p>
      <h2 class=Book_Subhead>Under way</h2><div class=Book_List>${
      quests.map((x, i) =>
        `<button class=Book_ListButton data-quest=${i} aria-pressed="${
          quest == i
        }">
          ${x.title}<small>${x.from} · ${x.progress}</small></button>`
      ).join('')
    }</div>
      <h2 class=Book_Subhead>Completed</h2><div class=Book_Card>✓ The baker's missing recipe</div>
      ${turns('left', q.title)}`,
    `<h1 class=Book_Head>${q.title}</h1><p class=Book_Meta>${q.from}</p>
      <blockquote class=Book_Quote>“${q.note}”</blockquote>
      <h2 class=Book_Subhead>What remains</h2><ol class=Book_Steps>${
      q.steps.map((s, i) =>
        `<li class="${i < q.done ? 'Book_Done' : ''}">${s}${
          i < q.done ? ' ✓' : ''
        }</li>`
      ).join('')
    }</ol>
      <div class=Book_Rule></div><p class=Book_Note>Pin a quest in the full game to keep its next step beside the trail.</p>
      <button class=Book_Action data-preview=pin type=button>Pin quest</button>
      <p class=Book_PreviewResponse role=status></p>${turns('right')}`,
  ]
}
let craftPages = () => {
  let r = recipes[recipe]
  let shown = recipes.map((x, i) => ({ x, i })).filter(({ x }) =>
    x.tier == tier
  )
  return [
    `<h1 class=Book_Head>Craft</h1><p class=Book_Lead>At the forge · choose a pattern.</p>
      <div class=Book_Pills>${
      ['I', 'II', 'III', 'IV', 'V'].map((t) =>
        `<button class=Book_Pill data-tier=${t} aria-pressed="${
          tier == t
        }">Tier ${t}</button>`
      ).join('')
    }</div>
      <h2 class=Book_Subhead>Patterns in this tier</h2><div class=Book_List>${
      shown.map(({ x, i }) =>
        `<button class=Book_ListButton data-recipe=${i} aria-pressed="${
          recipe == i
        }">
          ${
          image(x.kind)
        } ${x.name}<small>Item level ${x.level} · Tier ${x.tier}</small></button>`
      ).join('')
    }</div>
      <p class="Book_Note Book_Foot">Materials are counted from your bag.</p>${
      turns('left', r.name)
    }`,
    `<div class=Book_ItemTop><div class=Book_Picture>${image(r.kind)}</div><div>
      <h1 class=Book_ItemName>${r.name}</h1><p class=Book_Level>Item level ${r.level}</p>
      <div class=Book_Badges><span class=Book_Badge>Tier ${r.tier}</span>
      <span class="Book_Badge Book_Badge-rare">Possible rare</span></div></div></div>
      <div class=Book_Rule></div><h2 class=Book_Subhead>Possible item stats</h2>
      <div class="Book_Card Book_Stats">${r.stats.map(stat).join('')}</div>
      <h2 class=Book_Subhead>Materials</h2><div class=Book_Needs>${
      r.needs.map(([kind, name, count]) =>
        `<div class=Book_Need>${
          image(kind)
        }<span>${name}</span><span>${count}</span></div>`
      ).join('')
    }</div>
      <button class=Book_Action data-preview=craft type=button>Craft</button>
      <p class=Book_PreviewResponse role=status></p>
      <p class="Book_Note Book_Foot">The item level and stats roll when crafted. This preview shows their range.</p>
      ${turns('right')}`,
  ]
}
let draw = () => {
  let [left, right] = screen == 'bag'
    ? bagPages()
    : screen == 'journal'
    ? journalPages()
    : craftPages()
  root.innerHTML = `<section class=Book aria-label="Mossvale field book">
    <nav class=Book_Tabs aria-label="Book sections">${
    ([
      ['bag', 'Bag', 'backpack'],
      ['journal', 'Journal', 'journal'],
      ['craft', 'Craft', 'anvil'],
    ] as const).map(([id, name, symbol]) =>
      `<button class=Book_Tab data-screen=${id} ${
        screen == id ? 'aria-current=page' : ''
      }>
      ${glyph(symbol)}${name}</button>`
    ).join('')
  }</nav>
    <div class=Book_Frame><div class=Book_Spread data-page=${page}>
      <article class=Book_Page>${left}</article><article class=Book_Page>${right}</article>
    </div></div></section>`
}
root.addEventListener('click', (event) => {
  let button = (event.target as Element).closest<HTMLButtonElement>('button')
  if (!button) return
  if (button.dataset.preview) {
    let message = {
      equip: `Preview only — ${items[selected].name} was not equipped.`,
      pin: 'Preview only — the quest was not pinned.',
      craft: 'Preview only — no item was crafted.',
    }[button.dataset.preview]
    let status = button.parentElement?.querySelector('.Book_PreviewResponse')
    if (status) status.textContent = message ?? 'Preview only.'
    return
  }
  let {
    screen: next,
    page: nextPage,
    item,
    quest: nextQuest,
    recipe: nextRecipe,
    tier: nextTier,
  } = button.dataset
  let itemButton = item && Number(item) >= 0
    ? [...root.querySelectorAll(`[data-item="${item}"]`)].indexOf(button)
    : 0
  if (next) {
    screen = next as Screen
    page = 'left'
  }
  if (nextPage) page = nextPage as 'left' | 'right'
  if (item && Number(item) >= 0) {
    selected = Number(item)
    page = 'right'
  }
  if (nextQuest) {
    quest = Number(nextQuest)
    page = 'right'
  }
  if (nextRecipe) {
    recipe = Number(nextRecipe)
    page = 'right'
  }
  if (nextTier) {
    tier = nextTier
    recipe = recipes.findIndex((x) => x.tier == tier)
    page = 'left'
  }
  if (!next && !nextPage && !item && !nextQuest && !nextRecipe && !nextTier) {
    return
  }
  draw()
  let mobile = matchMedia('(max-width: 760px)').matches
  let focus = next
    ? root.querySelector<HTMLElement>(`[data-screen="${next}"]`)
    : nextTier
    ? root.querySelector<HTMLElement>(`[data-tier="${nextTier}"]`)
    : nextPage || (mobile && (item || nextQuest || nextRecipe))
    ? root.querySelector<HTMLElement>(
      `.Book_Page:${page == 'left' ? 'first' : 'last'}-child h1`,
    )
    : item
    ? root.querySelectorAll<HTMLElement>(`[data-item="${item}"]`)[itemButton]
    : nextQuest
    ? root.querySelector<HTMLElement>(`[data-quest="${nextQuest}"]`)
    : root.querySelector<HTMLElement>(`[data-recipe="${nextRecipe}"]`)
  if (focus) {
    if (!(focus instanceof HTMLButtonElement)) focus.tabIndex = -1
    focus.focus()
  }
})
draw()
