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
// (panel.ts), one open at a time: the map, the pack, a station's crafting,
// the menu, and the ones standing ready below. A panel is a row of SHEETS;
// `h.panels.<id>` hands its owner a `body` to draw into and `open` to say
// whether to. Draw only while it is open and only when what it shows changed,
// as map.ts and pack.ts do. Give it keys to open it, and a tray button with
// `tray(...)` below if it needs one; one opened from where it is used (a
// station, a villager) calls `show()`. Style its body in ui/<Name>.css, one
// block, from ui/theme.css's tokens; the sheet around it (head, close,
// scrolling, safe areas) is ui/Panel.css's and is never restyled per panel.
//
// How a button for the thumbs plugs in. `pad(action, face, title)` adds one,
// pressing its action (input.ts). On a phone each sits in its own slot of the
// ring around strike (ui/Hud.css, `.Hud_Pads`): the abilities (bar.ts) with
// the first two beside strike and the third further out, dodge, jump and the
// tonic. On a desktop they line up along the bottom with their keys.
// `Pad-none` hides a pad, `Pad-off` dims it, `--k` from 0 to 1 rings it with
// progress, and `--cd` sweeps a cooldown over it. Talking and gathering (or
// working a station) share one slot, and only one of them shows at a time.
import { type Action, keysOf } from './input.ts'
import type { Under } from './fx.ts'
import type { Frame } from './play.ts'
import type { Job } from './work.ts'
import { BEASTS } from './beasts.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { ITEMS } from './items.ts'
import { next, type Task, told, toward } from './journal.ts'
import type { Spot } from './levels.ts'
import { cap, type Panel, panels, type Spec } from './panel.ts'
import type { Quest } from './quests.ts'
import { need } from './rules.ts'
import { icon } from './sprites.ts'
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

export type Talk = {
  quest: Quest | null
  state: string
  have: number
  greets: string
  name: string
  /** they hear what is said beside them, and answer (village.ts) */
  hears?: boolean
  /** how their feeling shows, as in "looks tired" (villagers.ts) */
  looks?: string | null
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
  denied: 'The browser did not give the vale your microphone',
  spent: "This space's voice is spent for the month",
}

/** The panels the glass holds, and the keys that open them. Crafting opens
 * at a station (station.ts), and the deals beside a villager (dealbox.ts). */
export let SHEETS = {
  map: { title: 'Map', keys: ['KeyM'] },
  pack: { title: 'Pack', keys: ['KeyB', 'KeyI'] },
  menu: { title: 'Menu', keys: ['Escape'] },
  skills: { title: 'Skills', keys: ['KeyK'] },
  journal: { title: 'Journal', keys: ['KeyL'] },
  craft: { title: 'Crafting' },
  deal: { title: 'Deals' },
} satisfies Record<string, Spec>

/** Build the HUD into `root`. `press` sends a button's action to the game;
 * `busy` says when the keyboard belongs to something else. */
export let hud = (
  root: HTMLElement,
  press: (a: Action) => void,
  busy: () => boolean,
) => {
  let layer = el('Hud_Layer')
  let vitals = el('Vitals')
  let quest = el('Track', '', 'button')
  let foe = el('Foe')
  foe.hidden = true
  let nav = el('Hud_Nav')
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
  rose.title = `The map (${cap(SHEETS.map.keys[0])})`
  // Where the first quest tracked goes next, on the compass's rim.
  let aim = rose.querySelector<HTMLElement>('.Rose_Goal')!
  nav.append(who, rose, trayBox)
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

  let shelf = panels(root, busy)
  let sheet = (id: keyof typeof SHEETS) => shelf.add(id, SHEETS[id])
  let panel = {
    map: sheet('map'),
    pack: sheet('pack'),
    menu: sheet('menu'),
    skills: sheet('skills'),
    journal: sheet('journal'),
    craft: sheet('craft'),
    deal: sheet('deal'),
  }
  rose.addEventListener('click', panel.map.toggle)
  quest.addEventListener('click', panel.journal.toggle)
  quest.title = `Your journal (${cap(SHEETS.journal.keys[0])})`

  // A round button in the tray, and on a desktop its key; one that opens a
  // panel is marked while it is open.
  let marked: [HTMLElement, Panel][] = []
  let tray = (
    name: string,
    mark: Glyph,
    title: string,
    key: string,
    click: () => void,
    opens?: Panel,
  ) => {
    let b = el(
      `Orb Orb-${name}`,
      `${glyph(mark)}<kbd class=Key>${key}</kbd>`,
      'button',
    )
    b.title = `${title} (${key})`
    b.addEventListener('click', click)
    trayBox.append(b)
    if (opens) marked.push([b, opens])
    return b
  }
  let chat = tray('chat', 'chat', 'Chat', 'Enter', () => {})
  let bag = tray(
    'pack',
    'backpack',
    'Your pack',
    cap(SHEETS.pack.keys[0]),
    panel.pack.toggle,
    panel.pack,
  )
  tray(
    'journal',
    'journal',
    'Your journal',
    cap(SHEETS.journal.keys[0]),
    panel.journal.toggle,
    panel.journal,
  )
  // The skill board (board.ts), dotted while a point waits to be spent.
  let skills = tray(
    'skills',
    'sparkles',
    'Your skills',
    cap(SHEETS.skills.keys[0]),
    panel.skills.toggle,
    panel.skills,
  )
  let micKey = cap(keysOf('mic')[0])
  let mic = tray('mic', 'micOff', MICS.off, micKey, () => {})
  tray(
    'menu',
    'menu',
    'Menu',
    cap(SHEETS.menu.keys[0]),
    panel.menu.toggle,
    panel.menu,
  )

  // Said once, to a hero by a fire with nothing in hand.
  let nudged = false
  // Arms or armour found since the pack was last open.
  let fresh = false

  // A button for the thumbs, and on a desktop its key.
  let pad = (a: Action, face: string, title: string) => {
    let key = keysOf(a).map(cap)[0]
    let b = el(
      `Pad Pad-${a}`,
      face + (key ? `<kbd class=Key>${key}</kbd>` : ''),
      'button',
    )
    b.title = key ? `${title} (${key})` : title
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      press(a)
    })
    pads.append(b)
    return b
  }
  pad('strike', glyph('strike'), 'Strike')
  // The abilities' slots, which bar.ts paints.
  let abilities = (['ability1', 'ability2', 'ability3'] as const).map((a) =>
    pad(
      a,
      '<span class=Pad_Icon></span><b class=Pad_Left></b><i class=Pad_Star>✦</i>',
      'Ability',
    )
  )
  pad('dodge', glyph('dodge'), 'Dodge')
  pad('jump', glyph('jump'), 'Jump')
  let drinkPad = pad(
    'drink',
    '<span class=Pad_Icon></span><span class=Pad_N></span>',
    'Drink a tonic',
  )
  let talkPad = pad('talk', glyph('talk'), 'Talk')
  let gatherPad = pad('gather', '<span class=Pad_Icon></span>', 'Gather')
  let gatherIcon = gatherPad.querySelector<HTMLElement>('.Pad_Icon')!
  let gatherKey = cap(keysOf('gather')[0])
  gatherPad.classList.add('Pad-none')

  // The glass the scene's labels hide under (fx.ts): the cards, the buttons
  // and someone's words, with a gap's width round each, so no label shows
  // between two. Where each lies is read again only after one of them, or
  // the glass, changed size.
  let panes = [vitals, quest, foe, who, rose, trayBox, talk, ...pads.children]
  let rects: DOMRect[] | null = null
  let gap = 0
  let moved = new ResizeObserver(() => rects = null)
  for (let e of [root, ...panes]) moved.observe(e)
  let under: Under = (x, y, w, h) => {
    if (!rects) {
      rects = panes.map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0)
      gap = parseFloat(getComputedStyle(root).rowGap) || 0
    }
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

  // The quests tracked (journal.ts): each pinned one under way, its title
  // over the step it is on. With none pinned, how many are under way; with
  // none under way, who has one on offer, the nearest first.
  let line = (title: string, says: string) =>
    `<span class=Track_Quest><b>${title}</b><span>${says}</span></span>`
  let tracking = (tasks: Task[], f: Frame) => {
    let on = tasks.filter((t) => t.state == 'taken')
    let pinned = on.filter((t) => t.pinned).slice(0, 3)
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
    let key = cap(SHEETS.journal.keys[0])
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
    talk: (t: Talk | null, accept: () => void, handIn: () => void) => {
      talk.hidden = !t
      if (!t) return
      let q = t.quest
      let html = ''
      let act = ''
      if (!q) html = `<p>${esc(t.greets)}</p>`
      else if (t.state == 'open') {
        html = `<h3>${esc(q.title)}</h3><p>${
          esc(q.body)
        }</p><p class=Talk_Reward>Reward: ${q.xp} xp${
          q.gift ? `, ${esc(ITEMS[q.gift]?.name ?? q.gift)}` : ''
        }</p>`
        act = '<button class="Btn Btn-go" data-do=accept>I’ll do it</button>'
      } else if (t.have >= q.count) {
        html = `<h3>${
          esc(q.title)
        }</h3><p>You did it! The vale owes you one.</p>`
        act = '<button class="Btn Btn-go" data-do=hand>Hand it in</button>'
      } else {
        html = `<h3>${esc(q.title)}</h3><p>${
          esc(q.body)
        }</p><p class=Talk_Reward>${t.have} / ${q.count} so far.</p>`
      }
      if (t.hears) {
        html += `<p class=Talk_Hint>${
          t.looks ? `${esc(t.name)} ${esc(t.looks)}. ` : ''
        }Say something, and ${esc(t.name)} will answer.</p>`
      }
      talk.innerHTML = `<div class=Talk_Who>${
        esc(t.name)
      }</div><div class=Talk_Body>${html}</div><div class=Talk_Acts>${act}<button class=Btn data-do=close>Farewell</button></div>`
      talk.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          if (b.dataset.do == 'accept') accept()
          if (b.dataset.do == 'hand') handIn()
          hush()
        })
      )
    },
    get talking() {
      return !talk.hidden
    },
    /** the gather button, for this frame's work: its trade's icon while a node
     * or a station is near enough to work, dim while a node cannot be, and
     * ringed with how far the work has come; none while someone is near
     * enough to talk to */
    work: (job: Job | null) => {
      let n = job?.doing?.node ?? job?.near
      let trade = job?.doing?.trade ?? n?.lode.trade ?? job?.bench?.craft
      gatherPad.classList.toggle('Pad-none', !trade)
      if (!trade) return
      put('gather', gatherIcon, glyph(TRADES[trade].icon))
      gatherPad.title = `${TRADES[trade].name} (${gatherKey})`
      gatherPad.classList.toggle('Pad-off', !!n && (n.spent || !n.able))
      let k = job?.doing ? job.doing.k.toFixed(3) : '0'
      if (was.gatherK != k) {
        was.gatherK = k
        gatherPad.style.setProperty('--k', k)
      }
    },
    /** how the microphone stands (voicebox.ts) */
    mic: (m: Mic) => {
      mic.querySelector('.Glyph')!.outerHTML = glyph(
        m == 'on' ? 'mic' : 'micOff',
      )
      mic.classList.toggle('Orb-off', m == 'denied' || m == 'spent')
      mic.classList.toggle('Orb-on', m == 'on')
      mic.title = `${MICS[m]} (${micKey})`
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
      put(
        'vitals',
        vitals,
        `<div class=Vitals_Top><b class=Vitals_Name>${esc(s.name)}</b>${
          s.points
            ? `<span class="Badge Badge-points" title="Skill points to spend (K)">Level ${s.lvl} · ✦ ${s.points}</span>`
            : `<span class=Badge>Level ${s.lvl}</span>`
        }</div>` +
          meter(hp / s.max, 'Bar-hp', `${hp} / ${s.max}`) +
          meter(
            (s.xp - from) / Math.max(1, to - from),
            'Bar-xp',
            `${s.xp - from} / ${to - from} xp`,
          ),
      )
      put('quest', quest, tracking(tasks, f))
      let m = f.foe
      foe.hidden = !m
      if (m) {
        let b = BEASTS[m.kind]
        put(
          'foe',
          foe,
          meter(
            m.hp / m.most,
            'Bar-foe',
            `<b>${esc(b.name)}</b><em>level ${b.lvl}</em><small>${
              Math.ceil(m.hp)
            } / ${m.most}</small>`,
          ),
        )
        foe.classList.toggle('Foe-boss', !!b.boss)
      }
      let [sky, word] = CLOCKS[clock]
      put(
        'who',
        who,
        `<span class=Who_Dot></span><span class=Who_N>${here} here</span><span class=Who_Clock title="${word}">${
          glyph(sky)
        }<span>${word}</span></span>`,
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
      // Arms or armour found mark the bag, until the pack is opened.
      fresh = !panel.pack.open &&
        (fresh ||
          f.events.some((e) => e.type == 'loot' && ITEMS[e.item]?.slot))
      bag.classList.toggle('Orb-new', fresh)
      skills.classList.toggle('Orb-new', s.points > 0 && !panel.skills.open)
      // Nothing in hand by a fire: the rack there has arms to try.
      let bare = f.rack && !s.worn.main
      bag.classList.toggle('Orb-call', bare)
      if (bare && !nudged) {
        nudged = true
        toast('The rack by the fire has arms to try. Open your pack (B).')
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
      talkPad.classList.toggle('Pad-none', !f.talk)
      faint.hidden = !f.down
    },
  }
}
