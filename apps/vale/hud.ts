// The glass over the game, in one layout where nothing overlaps at any size
// (ui/Hud.css): the hero's vitals, the quest being followed and the foe at the
// top left, the compass, who is here and the tray of buttons at the top
// right, the toasts that say what just happened, the chat (chatbox.ts), and
// at the bottom the buttons for the thumbs, or the words of whoever you talk
// to. Each part is written only when what it shows changed. The scene's
// labels (fx.ts) are never seen through or between the glass: one that would
// touch it is not shown (`under`).
//
// How a panel plugs in. Every sheet that opens over the glass is a panel
// (panel.ts), one open at a time: the map, the hero's, a station's crafting,
// the menu, the yaks.app badge, and the ones standing ready below. A panel is
// a row of SHEETS;
// `h.panels.<id>` hands its owner a `body` to draw into and `open` to say
// whether to. Draw only while it is open and only when what it shows changed,
// as map.ts and pack.ts do. Give it keys to open it, and a tray button with
// `tray(...)` below if it needs one; one opened from where it is used (a
// station, a villager) calls `show()`. What is about the hero is a tab of
// their panel instead, a row of its `tabs`, handed out the same way. Style its
// body in ui/<Name>.css, one block, from ui/theme.css's tokens; the sheet
// around it (head, tabs, close, scrolling, safe areas) is ui/Panel.css's and
// is never restyled per panel.
//
// How a button for the thumbs plugs in. `pad(action, face, title)` adds one,
// pressing its action (input.ts). Touched, each sits in its own slot of the
// ring around strike (ui/Hud.css, `.Hud_Pads`): the abilities (bar.ts) with
// the first two beside strike and the third further out, dodge, jump and the
// tonic. With a mouse they line up along the bottom with their keys.
// `Pad-none` hides a pad, `Pad-off` dims it, `--k` from 0 to 1 rings it with
// progress, and `--cd` sweeps a cooldown over it. Talking and gathering (or
// working a station, or reading a board) share one slot, and only one of them
// shows at a time.
//
// Every button says what it does in its tip (tip.ts), shown while a mouse
// rests on it or a thumb holds it: its name, its key, and a line of what it
// does; an ability's is bar.ts's, with its numbers. Give a new button one.
import { about } from './about.ts'
import type { View } from './deals.ts'
import { type Action, keysOf } from './input.ts'
import { fireNear } from './fires.ts'
import type { Under } from './fx.ts'
import type { Frame } from './play.ts'
import type { Job } from './work.ts'
import { BEASTS } from './beasts.ts'
import { skull } from './danger.ts'
import { STATIONS } from './craft.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { ITEMS } from './items.ts'
import { next, type Task, told, toward } from './journal.ts'
import type { Spot } from './levels.ts'
import { cap, type Page, panels, type Spec, type TabSpec } from './panel.ts'
import type { Quest } from './quests.ts'
import { need } from './rules.ts'
import { icon } from './sprites.ts'
import { said } from './stock.ts'
import { type Tip, tip, tipped, tips } from './tip.ts'
import { TRADES } from './trades.ts'
import type { Mic } from './voicebox.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let el = (cls: string, html = '', tag = 'div') => {
  let e = document.createElement(tag)
  e.className = cls
  e.innerHTML = html
  return e
}

let meter = (k: number, cls: string, label = '') =>
  `<div class="Bar ${cls}"><i style="--k:${
    Math.max(0, Math.min(1, k)).toFixed(3)
  }"></i>${label ? `<span>${label}</span>` : ''}</div>`

export type Talk =
  & {
    name: string
    /** a line still shown when the villager has a quest on offer */
    note?: string | null
    /** another page the villager invites this hero to visit */
    link?: { href: string; label: string } | null
    /** they hear what is said beside them, and answer (village.ts) */
    hears?: boolean
    /** how their feeling shows, as in "looks tired" (villagers.ts) */
    looks?: string | null
  }
  & (
    | { quest: Quest | null; state: string; have: number; greets: string }
    | { offer: View }
    | { player: true; message: string; invite: boolean }
  )

/** The words and choices of a villager, including a note beside a quest. */
export let talkHtml = (t: Talk): string => {
  let html = ''
  let act = ''
  if ('player' in t) {
    html = `<p>${esc(t.message)}</p>`
    if (t.invite) {
      act = '<button class="Btn Btn-go" data-do=invite>Invite to party</button>'
    }
  } else if ('offer' in t) {
    let v = t.offer
    html = `<h3>An errand for ${esc(v.giver.name)}</h3><p>${
      v.steps.map((s) =>
        esc(
          `${s.deed ? 'Fell' : 'Bring'} ${s.n} ${
            BEASTS[s.kind]?.name ?? ITEMS[s.kind]?.name ?? s.kind
          }`,
        )
      ).join(', ')
    }</p><p class=Talk_Reward>Reward: ${esc(said(v.give))}</p>`
    act = '<button class="Btn Btn-go" data-do=accept>I’ll do it</button>' +
      '<button class=Btn data-do=refuse>No thanks</button>'
  } else {
    let q = t.quest
    if (!q) html = `<p>${esc(t.greets)}</p>`
    else if (t.state == 'open') {
      html = `<h3>${esc(q.title)}</h3><p>${
        esc(q.body)
      }</p><p class=Talk_Reward>Reward: ${q.xp} xp${
        q.gift ? `, ${esc(ITEMS[q.gift]?.name ?? q.gift)}` : ''
      }</p>`
      act = '<button class="Btn Btn-go" data-do=accept>I’ll do it</button>'
    } else if (t.have >= q.count) {
      html = `<h3>${esc(q.title)}</h3><p>You did it! The vale owes you one.</p>`
      act = '<button class="Btn Btn-go" data-do=hand>Hand it in</button>'
    } else {
      html = `<h3>${esc(q.title)}</h3><p>${
        esc(q.body)
      }</p><p class=Talk_Reward>${t.have} / ${q.count} so far.</p>`
    }
    if (q && t.note) html += `<p class=Talk_Hint>${esc(t.note)}</p>`
  }
  if (t.hears) {
    html += `<p class=Talk_Hint>${
      t.looks ? `${esc(t.name)} ${esc(t.looks)}. ` : ''
    }Say something, and ${esc(t.name)} will answer.</p>`
  }
  return `<div class=Talk_Who>${
    esc(t.name)
  }</div><div class=Talk_Body>${html}</div><div class=Talk_Acts>${act}${
    t.link
      ? `<a class=Btn href="${esc(t.link.href)}">${esc(t.link.label)}</a>`
      : ''
  }<button class=Btn data-do=close>Farewell</button></div>`
}

/** The time of day, as the glass shows it. */
export type Clock = 'night' | 'dawn' | 'day' | 'dusk'

let CLOCKS: Record<Clock, [Glyph, string]> = {
  night: ['moon', 'Night'],
  dawn: ['sunrise', 'Dawn'],
  day: ['sun', 'Day'],
  dusk: ['sunset', 'Dusk'],
}

let MICS: Record<Mic, string> = {
  off: 'Your microphone is off: turn it on and heroes near you hear you',
  starting: 'Asking for your microphone…',
  on: 'Heroes near you hear you',
  denied: 'Mic blocked: allow microphone access in your browser, then retry',
  missing: 'No microphone found: select or connect a browser input, then retry',
  spent: "This space's voice is spent for the month",
}

/** The panels the glass holds, and the keys that open them. The hero's is
 * one panel of tabs, each opened by its own keys (character.ts, pack.ts,
 * board.ts, trades.ts, journal.ts), and by a tap on the hero's frame on
 * themselves. Crafting opens at a station (station.ts), the notices at a
 * village's board (notices.ts), and the deals beside a villager (dealbox.ts).
 * The map and the menu are one size whatever is done in them, so each is as
 * tall as it is; every other sheet keeps one height (ui/Panel.css). */
export let SHEETS = {
  about: { title: 'Make this world yours', tall: 'auto' },
  map: { title: 'Map', keys: ['KeyM'], tall: 'auto' },
  party: { title: 'Party', keys: ['KeyO'], tall: 'auto' },
  hero: {
    title: 'Your hero',
    tabs: {
      character: { title: 'Character', icon: 'user', keys: ['KeyH'] },
      bag: { title: 'Bag', icon: 'backpack', keys: ['KeyB', 'KeyI'] },
      skills: { title: 'Skills', icon: 'sparkles', keys: ['KeyK'] },
      trades: { title: 'Trades', icon: 'hammer', keys: ['KeyP'] },
      journal: { title: 'Journal', icon: 'journal', keys: ['KeyL'] },
    },
  },
  menu: { title: 'Menu', keys: ['Escape'], tall: 'auto' },
  craft: { title: 'Crafting' },
  notices: { title: 'Notice board' },
  deal: { title: 'Deals' },
} satisfies Record<string, Spec & { tabs?: Record<string, TabSpec> }>

// The keys of the hero's tabs.
let TABS = SHEETS.hero.tabs

/** Build the HUD into `root`. `press` sends a button's action to the game;
 * `busy` says when the keyboard belongs to something else. */
export let hud = (
  root: HTMLElement,
  press: (a: Action) => void,
  busy: () => boolean,
) => {
  let layer = el('Hud_Layer')
  let vitals = el('Vitals', '', 'button')
  let quest = el('Track', '', 'button')
  let foe = el('Foe')
  foe.hidden = true
  let nav = el('Hud_Nav')
  let badge = el('YaksBadge', 'yaks.app', 'button')
  badge.setAttribute('type', 'button')
  badge.setAttribute('aria-label', 'About Mossvale and yaks.app')
  let who = el('Who')
  let trayBox = el('Hud_Tray')
  // The compass, which opens the map. Up is the way the camera looks, and
  // each letter stands where its way lies: ui/Rose.css turns them by
  // `--turn`, the bearing.
  let rose = el(
    'Rose',
    ['N', 'E', 'S', 'W'].map((d, k) =>
      `<i class="Rose_Mark${k ? '' : ' Rose_Mark-n'}" style="--at:${
        k * 90
      }deg">${d}</i><i class=Rose_Tick style="--at:${k * 90 + 45}deg"></i>`
    ).join('') +
      `<i class=Rose_Goal hidden></i><kbd class=Key>${
        cap(SHEETS.map.keys[0])
      }</kbd>`,
    'button',
  )
  tip(rose, {
    name: 'Map',
    key: cap(SHEETS.map.keys[0]),
    says: 'Where you are, where your quest goes next, and who is where.',
  })
  // Where the first quest tracked goes next, on the compass's rim.
  let aim = rose.querySelector<HTMLElement>('.Rose_Goal')!
  nav.append(badge, who, rose, trayBox)
  let toasts = el('Hud_Toasts')
  let pads = el('Hud_Pads')
  let talk = el('Talk')
  talk.hidden = true
  let faint = el(
    'Faint',
    '<div class=Faint_Card><b>You fainted.</b><span>You will wake by the fire, patched up.</span></div>',
  )
  faint.hidden = true
  root.append(layer, vitals, quest, foe, nav, toasts, pads, talk, faint)
  tips(root)

  let shelf = panels(root, busy)
  let panel = {
    about: shelf.add('about', SHEETS.about),
    map: shelf.add('map', SHEETS.map),
    party: shelf.add('party', SHEETS.party),
    ...shelf.book('hero', SHEETS.hero),
    menu: shelf.add('menu', SHEETS.menu),
    craft: shelf.add('craft', SHEETS.craft),
    notices: shelf.add('notices', SHEETS.notices),
    deal: shelf.add('deal', SHEETS.deal),
  }
  about(panel.about)
  badge.addEventListener('click', panel.about.toggle)
  rose.addEventListener('click', panel.map.toggle)
  // The hero's frame opens their panel on themselves.
  vitals.addEventListener('click', panel.character.toggle)
  tip(vitals, {
    name: 'You',
    key: cap(TABS.character.keys[0]),
    says: 'How you look, and how you fight.',
  })
  quest.addEventListener('click', panel.journal.toggle)
  tip(quest, {
    name: 'Your journal',
    key: cap(TABS.journal.keys[0]),
    says: 'Every quest and deal you have, and how far each has come.',
  })

  // A round button in the tray, and with a keyboard its key; one that opens a
  // panel is marked while it is open.
  let marked: [HTMLElement, Page][] = []
  let tray = (
    name: string,
    mark: Glyph,
    t: Tip & { key: string },
    click: () => void,
    opens?: Page,
  ) => {
    let b = el(
      `Orb Orb-${name}`,
      `${glyph(mark)}<kbd class=Key>${t.key}</kbd>`,
      'button',
    )
    tip(b, t)
    b.addEventListener('click', click)
    trayBox.append(b)
    if (opens) marked.push([b, opens])
    return b
  }
  let chat = tray('chat', 'chat', {
    name: 'Chat',
    key: 'Enter',
    says: 'Say something to whoever is here.',
  }, () => {})
  let bag = tray(
    'pack',
    'backpack',
    {
      name: 'Your bag',
      key: cap(TABS.bag.keys[0]),
      says: 'What you wear and carry, and by a fire, arms to try.',
    },
    panel.bag.toggle,
    panel.bag,
  )
  let fire = tray(
    'fire',
    'flame',
    {
      name: 'Travel by fire',
      key: cap(SHEETS.map.keys[0]),
      says: 'Choose a village fire you have found.',
    },
    panel.map.show,
    panel.map,
  )
  fire.hidden = true
  tray(
    'journal',
    'journal',
    {
      name: 'Your journal',
      key: cap(TABS.journal.keys[0]),
      says: 'Every quest and deal you have, and how far each has come.',
    },
    panel.journal.toggle,
    panel.journal,
  )
  // The skill board (board.ts), dotted while a point waits to be spent.
  let skills = tray(
    'skills',
    'sparkles',
    {
      name: 'Your skills',
      key: cap(TABS.skills.keys[0]),
      says: 'Spend the point each level brings on a skill.',
    },
    panel.skills.toggle,
    panel.skills,
  )
  let party = tray(
    'party',
    'users',
    {
      name: 'Party',
      key: cap(SHEETS.party.keys[0]),
      says: 'Invitations, members, and where they are.',
    },
    panel.party.toggle,
    panel.party,
  )
  let micKey = cap(keysOf('mic')[0])
  let mic = tray('mic', 'micOff', {
    name: 'Microphone',
    key: micKey,
    says: MICS.off,
  }, () => {})
  tray(
    'menu',
    'menu',
    {
      name: 'Menu',
      key: cap(SHEETS.menu.keys[0]),
      says: 'Sound, the camera, and every key and touch.',
    },
    panel.menu.toggle,
    panel.menu,
  )

  // Said once, to a hero by a fire with nothing in hand.
  let nudged = false
  // Arms or armour found since the bag was last open.
  let fresh = false

  // A button for the thumbs, and with a keyboard its key.
  let pad = (a: Action, face: string, t: Tip) => {
    let key = keysOf(a).map(cap)[0]
    let b = el(
      `Pad Pad-${a}`,
      face + (key ? `<kbd class=Key>${key}</kbd>` : ''),
      'button',
    )
    tip(b, { ...t, key })
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      press(a)
    })
    pads.append(b)
    return b
  }
  // The strike's and the abilities' tips are bar.ts's, which paints them.
  pad('strike', '<span class=Pad_Icon></span>', { name: 'Strike' })
  let abilities = (['ability1', 'ability2', 'ability3'] as const).map((a) =>
    pad(
      a,
      '<span class=Pad_Icon></span><b class=Pad_Left></b><i class=Pad_Star>✦</i>',
      { name: '' },
    )
  )
  pad('dodge', glyph('dodge'), {
    name: 'Dodge',
    says:
      'Roll clear. A bite you roll through leaves the biter open to a great blow.',
  })
  pad('jump', glyph('jump'), { name: 'Jump' })
  let drinkPad = pad(
    'drink',
    '<span class=Pad_Icon></span><span class=Pad_N></span>',
    { name: 'Drink a tonic' },
  )
  let drinkKey = cap(keysOf('drink')[0])
  let talkPad = pad('talk', glyph('talk'), {
    name: 'Talk',
    says: 'Talk to whoever is beside you.',
  })
  let gatherPad = pad('gather', '<span class=Pad_Icon></span>', {
    name: 'Gather',
  })
  let nearBench = false
  let gatherIcon = gatherPad.querySelector<HTMLElement>('.Pad_Icon')!
  let gatherKey = cap(keysOf('gather')[0])
  gatherPad.classList.add('Pad-none')

  // The glass the scene's labels hide under (fx.ts): the cards, the buttons
  // and someone's words, with a gap's width round each, so no label shows
  // between two. Where each lies is read again only after one of them, or
  // the glass, changed size.
  let panes = [vitals, quest, foe, who, rose, trayBox, talk, ...pads.children]
  let rects: DOMRect[] = []
  let gap = 0
  let moved = new ResizeObserver(() => {
    rects = panes.map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0)
    gap = parseFloat(getComputedStyle(root).rowGap) || 0
  })
  for (let e of [root, ...panes]) moved.observe(e)
  let under: Under = (x, y, w, h) => {
    return rects.some((r) =>
      x < r.right + gap && x + w > r.left - gap &&
      y < r.bottom + gap && y + h > r.top - gap
    )
  }

  let was: Record<string, string> = {}
  let put = (key: string, e: HTMLElement, html: string) => {
    if (was[key] == html) return
    was[key] = html
    e.innerHTML = html
  }

  // What just happened, after a picture of what it was about, if one: a
  // thing's sprite (sprites.ts) or a glyph in the text (glyphs.ts).
  let toast = (text: string, cls = '', face = '') => {
    let t = el(`Toast ${cls}`, `${face} ${esc(text)}`)
    toasts.append(t)
    setTimeout(() => t.classList.add('Toast-out'), 2600)
    setTimeout(() => t.remove(), 3200)
    while (toasts.children.length > 3) toasts.firstElementChild?.remove()
  }

  // The quests tracked (journal.ts): each pinned one, its title over the
  // step it is on. With none pinned, how many are under way; with none under
  // way, who has one on offer, the nearest first.
  let line = (title: string, says: string) =>
    `<span class=Track_Quest><b>${title}</b><span>${says}</span></span>`
  let tracking = (tasks: Task[], f: Frame) => {
    let on = tasks.filter((t) => t.state == 'taken')
    let pinned = tasks.filter((t) => t.pinned).slice(0, 3)
    if (pinned.length) {
      return pinned.map((t) => {
        let s = next(t)
        return line(
          esc(t.title),
          s
            ? esc(told(s, f.level)) +
              (s.need ? ` <em>${s.have ?? 0} / ${s.need}</em>` : '')
            : 'Done!',
        )
      }).join('')
    }
    let key = cap(TABS.journal.keys[0])
    if (on.length) {
      return line(`${on.length} under way`, `Open your journal (${key})`)
    }
    let near = new Set(f.givers.map((g) => g.id))
    let open = tasks.filter((t) => t.state == 'open')
    let t = open.find((t) => near.has(t.giver)) ?? open[0]
    if (!t) {
      return line('The vale is at peace.', 'Every quest is done. Well walked.')
    }
    return line(
      `${esc(t.from)} has a job for you`,
      f.talk?.id == t.giver ? 'Say hello.' : esc(told(t.steps[0], f.level)),
    )
  }

  let hush = () => talk.hidden = true
  addEventListener('keydown', (e) => {
    if (e.code == 'Escape' && !talk.hidden) hush()
  })

  return {
    layer,
    /** whether a label of the scene's would be under the glass */
    under,
    /** the tray's buttons that others answer: chat (chatbox.ts), and the
     * microphone (voicebox.ts), whose tap the browser may ask about */
    orbs: { chat, mic },
    panels: panel,
    /** the strike and the abilities' pads, for the action bar (bar.ts) */
    acts: [pads.querySelector<HTMLElement>('.Pad-strike')!, ...abilities],
    toast,
    /** someone's words, or none */
    talk: (
      t: Talk | null,
      acts: {
        accept?: () => void
        hand?: () => void
        refuse?: () => void
        invite?: () => void
      } = {},
    ) => {
      talk.hidden = !t
      if (!t) return
      talk.innerHTML = talkHtml(t)
      talk.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          if (b.dataset.do == 'accept') acts.accept?.()
          if (b.dataset.do == 'hand') acts.hand?.()
          if (b.dataset.do == 'refuse') acts.refuse?.()
          if (b.dataset.do == 'invite') acts.invite?.()
          hush()
        })
      )
    },
    get talking() {
      return !talk.hidden
    },
    partyBadge: (n: number) => {
      party.classList.toggle('Orb-new', n > 0 && !panel.party.open)
    },
    /** the gather button, for this frame's work: its trade's icon while a node
     * or a station is near enough to work, dim while a node cannot be, and
     * ringed with how far the work has come, or the board's while one is near
     * enough to read; none while someone is near enough to talk to */
    work: (job: Job | null) => {
      nearBench = !!job?.bench
      let n = job?.doing?.node ?? job?.near
      let trade = job?.doing?.trade ?? n?.lode.trade ?? job?.bench?.craft
      let board = !trade && !!job?.board
      gatherPad.classList.toggle('Pad-none', !trade && !board)
      if (!trade && !board) return
      put('gather', gatherIcon, glyph(trade ? TRADES[trade].icon : 'notices'))
      tip(
        gatherPad,
        trade
          ? {
            name: TRADES[trade].name,
            key: gatherKey,
            says: n
              ? `Gather from the ${n.name.toLowerCase()}.`
              : job?.bench
              ? `Work the ${STATIONS[job.bench.craft].name.toLowerCase()}.`
              : undefined,
          }
          : {
            name: 'Notice board',
            key: gatherKey,
            says: 'Read the jobs pinned on it.',
          },
      )
      gatherPad.classList.toggle('Pad-off', !!n?.spent)
      let k = job?.doing ? job.doing.k.toFixed(3) : '0'
      if (was.gatherK != k) {
        was.gatherK = k
        gatherPad.style.setProperty('--k', k)
      }
    },
    /** how the microphone stands (voicebox.ts) */
    mic: (m: Mic, input?: string | null, sending = false) => {
      let icon: 'mic' | 'micOff' = m == 'on' ? 'mic' : 'micOff'
      if (mic.dataset.icon != icon) {
        mic.querySelector('.Glyph')!.outerHTML = glyph(icon)
        mic.dataset.icon = icon
      }
      mic.classList.toggle(
        'Orb-off',
        m == 'denied' || m == 'missing' || m == 'spent',
      )
      mic.classList.toggle('Orb-on', m == 'on')
      mic.classList.toggle('Orb-sending', sending)
      tip(mic, {
        name: 'Microphone',
        key: micKey,
        says: `${MICS[m]}${input && m == 'on' ? ` · Input: ${input}` : ''}${
          sending ? ' · Voice going out' : ''
        }`,
      })
    },
    /** paint this frame, the camera looking `facing` degrees from north,
     * tracking the hero's `tasks` (journal.ts), the compass pointing to `goal`,
     * where the first one tracked goes next */
    show: (
      f: Frame,
      here: number,
      clock: Clock,
      facing: number,
      tasks: Task[],
      goal: Spot | null,
    ) => {
      let s = f.sheet
      let hp = f.vitals.hp
      let from = need(s.lvl), to = need(s.lvl + 1)
      let capped = s.lvl == 60
      put(
        'vitals',
        vitals,
        `<div class=Vitals_Top><b class=Vitals_Name>${esc(s.name)}</b>${
          s.points
            ? `<span class="Badge Badge-points"${
              tipped({
                name: 'Skill points to spend',
                key: cap(TABS.skills.keys[0]),
              })
            }>Level ${s.lvl} · ✦ ${s.points}</span>`
            : `<span class=Badge>Level ${s.lvl}</span>`
        }</div>` +
          meter(hp / s.max, 'Bar-hp', `Health ${hp} / ${s.max}`) +
          meter(
            capped ? 1 : (s.xp - from) / Math.max(1, to - from),
            'Bar-xp',
            capped ? 'Max level' : `${s.xp - from} / ${to - from} xp`,
          ) + `<kbd class=Key>${cap(TABS.character.keys[0])}</kbd>`,
      )
      put('quest', quest, tracking(tasks, f))
      let m = f.foe
      foe.hidden = !m
      if (m) {
        let b = BEASTS[m.kind]
        let danger = skull(m.lvl, s.lvl)
        put(
          'foe',
          foe,
          meter(
            m.hp / m.most,
            'Bar-foe',
            `<b>${esc(b.name)}</b><em${
              danger ? ' title="Overwhelming foe"' : ''
            }>${danger ? '☠' : `level ${m.lvl}`}</em><small>${
              Math.ceil(m.hp)
            } / ${m.most}</small>`,
          ),
        )
        foe.classList.toggle('Foe-boss', !!b.boss)
        foe.classList.toggle('Foe-danger', danger)
      }
      let [sky, word] = CLOCKS[clock]
      put(
        'who',
        who,
        `<span class=Who_Dot></span><span class=Who_N>${here} here</span><span class=Who_Clock${
          tipped({ name: word })
        }>${glyph(sky)}<span>${word}</span></span>`,
      )
      if (was.rose != String(facing)) {
        was.rose = String(facing)
        rose.style.setProperty('--turn', `${facing}deg`)
      }
      let way = goal ? String(toward([f.body.x, f.body.z], goal)) : ''
      if (was.aim != way) {
        was.aim = way
        aim.hidden = !goal
        aim.style.setProperty('--at', `${way || 0}deg`)
      }
      for (let [b, p] of marked) b.classList.toggle('Orb-on', p.open)
      fire.hidden = f.down || !fireNear(f.body.x, f.body.z)
      // Arms or armour found mark the bag, until it is opened; points to
      // spend mark the skills.
      fresh = !panel.bag.open &&
        (fresh ||
          f.events.some((e) => e.type == 'loot' && ITEMS[e.item]?.slot))
      bag.classList.toggle('Orb-new', fresh)
      panel.bag.mark(fresh)
      skills.classList.toggle('Orb-new', s.points > 0 && !panel.skills.open)
      panel.skills.mark(s.points > 0)
      // Nothing in hand by a fire: the rack there has arms to try.
      let bare = f.rack && !s.worn.main
      bag.classList.toggle('Orb-call', bare)
      if (bare && !nudged) {
        nudged = true
        toast(
          `The rack by the fire has arms to try. Open your bag (${
            cap(TABS.bag.keys[0])
          }).`,
        )
      }
      // Whatever mends, which drinking takes (play.ts), the first first.
      let mends = s.bag.filter((h) => ITEMS[h.kind]?.heals)
      let tonics = mends.reduce((n, h) => n + h.n, 0)
      put(
        'tonicIcon',
        drinkPad.querySelector('.Pad_Icon')!,
        icon(mends[0]?.kind ?? 'tonic'),
      )
      put(
        'tonic',
        drinkPad.querySelector('.Pad_N')!,
        tonics ? String(tonics) : '',
      )
      drinkPad.classList.toggle('Pad-off', !tonics)
      let first = ITEMS[mends[0]?.kind ?? '']
      tip(drinkPad, {
        name: 'Drink a tonic',
        key: drinkKey,
        says: first
          ? `${first.name}: mends ${first.heals}. ${tonics} in your bag.`
          : 'Nothing in your bag mends.',
      })
      talkPad.classList.toggle('Pad-none', !f.talk && !f.peer || !!nearBench)
      faint.hidden = !f.down
    },
  }
}
