// The glass over the game, in one layout where nothing overlaps at any size
// (ui/Hud.css): the hero's vitals, the quest being followed and the foe at the
// top left, the compass, who is here and the tray of buttons at the top
// right, the toasts that say what just happened, the chat (chatbox.ts), and
// at the bottom the buttons for the thumbs, or the words of whoever you talk
// to. Its parts are the kit's (kit/Vale*.ts, packages/ui): meters, keycaps,
// a level's badge, the compass, the tray's orbs, the toasts and the tiles of
// the quests followed. Each part is drawn again only when what it shows
// changed (`paint`). The scene's labels (fx.ts) are never seen through or
// between the glass: one that would touch it is not shown (`under`).
//
// Every interface opens as a tab of one sheet (panel.ts). SHEETS lists its
// tabs; `h.panels.<id>` gives each owner a body and whether it is open. Draw
// only while it is open and only when its content changes. A key or tray
// button opens its tab; a station or villager calls show(). Contextual titles
// belong to head(), below the shared tabs. Style the content in ui/<Name>.css;
// the shell, scrolling and safe areas belong to ui/Panel.css.
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
import { type ComponentChildren, Fragment, h, render } from 'preact'
import { Body, Button, Dot, Rows, Tile } from '@yaks/ui'
import { about } from './about.ts'
import { experience } from './character.ts'
import type { View } from './deals.ts'
import { type Action, keysOf } from './input.ts'
import type { Under } from './fx.ts'
import type { Frame, Mob, Sheet } from './play.ts'
import type { Job } from './work.ts'
import { BEASTS } from './beasts.ts'
import { skull } from './danger.ts'
import { STATIONS } from './craft.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { ValeBadge } from './kit/ValeBadge.ts'
import { ValeCompass } from './kit/ValeCompass.ts'
import { ValeKeycap } from './kit/ValeKeycap.ts'
import { ValeMeter } from './kit/ValeMeter.ts'
import { type Marks, ValeOrb } from './kit/ValeOrb.ts'
import { type Tone, ValeToast } from './kit/ValeToast.ts'
import { fullscreen } from './ui/fullscreen.ts'
import { ITEMS } from './items.ts'
import { next, type Task, told, toward } from './journal.ts'
import type { Spot } from './levels.ts'
import { cap, type Page, panels, type Spec, type TabSpec } from './panel.ts'
import type { Quest } from './quests.ts'
import { type PageState, pageState } from './page-state.ts'
import { type Rarity, tint } from './rarity.ts'
import { icon } from './sprites.ts'
import { labels } from './status.ts'
import { said } from './stock.ts'
import { mark, part } from './tile.ts'
import { heard, type Tip, tip, tipProps, tips } from './tip.ts'
import { TRADES } from './trades.ts'
import type { Mic } from './voicebox.ts'

let el = (cls: string, tag = 'div') => {
  let e = document.createElement(tag)
  e.className = cls
  return e
}

// Markup of the game's own (a sprite, a glyph set in text), held in a line.
let raw = (html: string) =>
  h('span', { dangerouslySetInnerHTML: { __html: html } })

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

/** What the hero can answer someone talking: take their errand or quest,
 * refuse it, hand it in, or ask them along. */
export type Answers = {
  accept?: () => void
  hand?: () => void
  refuse?: () => void
  invite?: () => void
}

/** The words and choices of whoever is talked to: their name on a badge,
 * what they say, a note beside a quest, and the answers, each of which does
 * its part of `answers` and then `done`. */
export let talkView = (
  t: Talk,
  answers: Answers = {},
  done = () => {},
): ComponentChildren => {
  let say = (...lines: string[]) =>
    h(Body, {}, lines.map((l) => h('p', { key: l }, l)))
  let aside = (words: string) => h(Body, { mod: 'short' }, h('p', {}, words))
  let answer = (does: keyof Answers | 'close', words: string) =>
    h(Button, {
      key: does,
      mod: does != 'close' && does != 'refuse' && 'go',
      'data-do': does,
      onClick: () => {
        if (does != 'close') answers[does]?.()
        done()
      },
    }, words)
  let words: ComponentChildren[] = [], acts: ComponentChildren[] = []
  if ('player' in t) {
    words = [say(t.message)]
    if (t.invite) acts = [answer('invite', 'Invite to party')]
  } else if ('offer' in t) {
    let v = t.offer
    words = [part(
      `An errand for ${v.giver.name}`,
      say(
        v.steps.map((s) =>
          `${s.deed ? 'Fell' : 'Bring'} ${s.n} ${
            BEASTS[s.kind]?.name ?? ITEMS[s.kind]?.name ?? s.kind
          }`
        ).join(', '),
      ),
      aside(`Reward: ${said(v.give)}`),
    )]
    acts = [answer('accept', 'I’ll do it'), answer('refuse', 'No thanks')]
  } else {
    let q = t.quest
    if (!q) words = [say(t.greets)]
    else if (t.state == 'open') {
      words = [part(
        q.title,
        say(q.body),
        aside(
          `Reward: ${q.xp} xp${
            q.gift ? `, ${ITEMS[q.gift]?.name ?? q.gift}` : ''
          }`,
        ),
      )]
      acts = [answer('accept', 'I’ll do it')]
    } else if (t.have >= q.count) {
      words = [part(q.title, say('You did it! The vale owes you one.'))]
      acts = [answer('hand', 'Hand it in')]
    } else {
      words = [part(
        q.title,
        say(q.body),
        aside(`${t.have} / ${q.count} so far.`),
      )]
    }
    if (q && t.note) words.push(aside(t.note))
  }
  if (t.hears) {
    words.push(
      aside(
        `${
          t.looks ? `${t.name} ${t.looks}. ` : ''
        }Say something, and ${t.name} will answer.`,
      ),
    )
  }
  return [
    h(ValeBadge, { class: 'Talk_Who' }, t.name),
    h('div', { class: 'Talk_Body' }, words),
    h(
      'div',
      { class: 'Talk_Acts' },
      acts,
      t.link && h(Button, { href: t.link.href }, t.link.label),
      answer('close', 'Farewell'),
    ),
  ]
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

/** The hero's interfaces, with Menu last; world interactions have their own
 * sheets, opened from their places rather than from the navigation tabs. */
export let SHEETS = {
  hero: {
    title: 'Mossvale',
    tabs: {
      character: { title: 'Character', icon: 'user', keys: ['KeyH'] },
      bag: { title: 'Bag', icon: 'backpack', keys: ['KeyB', 'KeyI'] },
      skills: { title: 'Skills', icon: 'sparkles', keys: ['KeyK'] },
      trades: { title: 'Trades', icon: 'hammer', keys: ['KeyP'] },
      journal: { title: 'Journal', icon: 'journal', keys: ['KeyL'] },
      map: { title: 'Map', icon: 'mountain', keys: ['KeyM'] },
      party: { title: 'Party', icon: 'users', keys: ['KeyO'] },
      menu: { title: 'Menu', icon: 'menu', keys: ['Escape'] },
    },
  },
  craft: { title: 'Crafting' },
  notices: { title: 'Notice board' },
  deal: { title: 'Deals' },
  about: { title: 'About', tall: 'auto' },
} satisfies Record<string, Spec & { tabs?: Record<string, TabSpec> }>

let TABS = SHEETS.hero.tabs

// The hero's name and level over their health, what ails them, and the xp to
// the next level; gold while points wait to be spent on skills.
let vitalsView = (s: Sheet, hp: number, ails: string) => [
  h(
    'div',
    { class: 'Vitals_Top' },
    h('b', { class: 'Vitals_Name' }, s.name),
    h(
      ValeBadge,
      {
        calling: s.points > 0,
        ...(s.points
          ? tipProps({
            name: 'Skill points to spend',
            key: cap(TABS.skills.keys[0]),
          })
          : {}),
      },
      `Level ${s.lvl}${s.points ? ` · ✦ ${s.points}` : ''}`,
    ),
  ),
  h(ValeMeter, { label: 'Health', value: hp, max: s.max }),
  ails && h('small', {}, ails),
  experience(s),
  h(ValeKeycap, { keycap: cap(TABS.character.keys[0]) }),
]

// The quests followed (journal.ts `tracked`), each its title over its next
// step and how far that has come.
let trackView = (shown: Task[], here: string) =>
  h(
    Rows,
    {},
    shown.length
      ? shown.map((t) => {
        let s = next(t)
        return h(
          Tile,
          { key: t.id },
          h(Tile.Title, {}, t.title),
          h(Tile.Sub, {}, s ? told(s, here) : 'Done!'),
          s?.need ? h(Tile.End, {}, `${s.have ?? 0} / ${s.need}`) : null,
        )
      })
      : h(
        Tile,
        {},
        h(Tile.Title, {}, 'No quests here.'),
        h(Tile.Sub, {}, `Open your journal (${cap(TABS.journal.keys[0])})`),
      ),
  )

// The creature fought: its name and level, or a skull for one far above the
// hero, over its health.
let foeView = (m: Mob, lvl: number) => {
  let name = BEASTS[m.beast].name, danger = skull(m.lvl, lvl)
  let hp = Math.ceil(m.hp)
  return h(
    ValeMeter,
    { label: name, value: hp, max: m.most, tone: 'danger' },
    h('b', {}, name),
    h(
      'em',
      danger ? { title: 'Overwhelming foe' } : {},
      danger ? '☠' : `level ${m.lvl}`,
    ),
    h('small', {}, `${hp} / ${m.most}`),
  )
}

// How many are here, and the time of day.
let whoView = (here: number, clock: Clock) => {
  let [sky, word] = CLOCKS[clock]
  return [
    h(Dot, { mod: 'positive' }),
    h('span', {}, `${here} here`),
    h(
      'span',
      { class: 'Who_Clock', ...tipProps({ name: word }), 'aria-label': word },
      mark(sky),
      h('span', { class: 'Who_Word' }, word),
    ),
  ]
}

/** A tray button another module answers: the button, for its events, and
 * its marks, which that module sets. */
export type Opener = { button: HTMLElement; mark: (m: Marks) => void }

// A tray button: its icon, its tip, its marks, and what pressing it does.
type Orb = { glyph: Glyph; tip: Tip; marks: Marks; press: () => void }

/** Build the HUD into `root`. `press` sends a button's action to the game;
 * `busy` says when the keyboard belongs to something else. */
export let hud = (
  root: HTMLElement,
  press: (a: Action) => void,
  busy: () => boolean,
  state: PageState = pageState(),
) => {
  let layer = el('Hud_Layer')
  let vitals = el('Vitals', 'button')
  let quest = el('Track', 'button')
  let foe = el('Foe')
  foe.hidden = true
  let nav = el('Hud_Nav')
  let badge = el('YaksBadge', 'button')
  badge.textContent = 'yaks.app'
  badge.setAttribute('type', 'button')
  badge.setAttribute('aria-label', 'About Mossvale and yaks.app')
  let who = el('Who')
  let trayBox = el('Hud_Tray')
  // The compass, which opens the map. Up is the way the camera looks, and
  // each letter stands where its way lies (kit/ValeCompass.ts).
  let rose = el('Hud_Rose', 'button')
  tip(rose, {
    name: 'Map',
    key: cap(TABS.map.keys[0]),
    says: 'Where you are, where your quest goes next, and who is where.',
  })
  nav.append(badge, who, rose, trayBox)
  let toasts = el('Hud_Toasts')
  let pads = el('Hud_Pads')
  let talk = el('Talk')
  talk.hidden = true
  let faint = el('Faint')
  render(
    h(
      ValeToast,
      { tone: 'harm' },
      'You fainted.',
      h('br', {}),
      h('small', {}, 'You will wake by the fire, patched up.'),
    ),
    faint,
  )
  faint.hidden = true
  root.append(layer, vitals, quest, foe, nav, toasts, pads, talk, faint)
  tips(root)

  // Draw `view` into `e`, unless what it shows, `shows`, is as it was.
  let drawn = new Map<Element, string>()
  let paint = (e: Element, shows: unknown, view: () => ComponentChildren) => {
    let key = JSON.stringify(shows)
    if (drawn.get(e) == key) return
    drawn.set(e, key)
    render(h(Fragment, {}, view()), e)
  }

  let shelf = panels(root, busy, state)
  let panel = {
    ...shelf.book('hero', SHEETS.hero),
    craft: shelf.add('craft', SHEETS.craft),
    notices: shelf.add('notices', SHEETS.notices),
    deal: shelf.add('deal', SHEETS.deal),
    about: shelf.add('about', SHEETS.about),
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

  // What just happened, after a picture of what it was about, if one: a
  // thing's sprite (sprites.ts) or a glyph in the text (glyphs.ts). Three
  // show at most, each a moment, then fading as it goes.
  type Note = {
    id: number
    text: string
    tone?: Tone
    rarity?: Rarity
    face?: string
    out?: boolean
  }
  let notes: Note[] = [], noted = 0
  let drawNotes = () =>
    render(
      notes.map((n) =>
        h(
          ValeToast,
          {
            key: n.id,
            tone: n.tone,
            class: ['Hud_Toast', n.out && 'Hud_Toast-out', tint(n.rarity)]
              .filter(Boolean).join(' '),
          },
          n.face && [raw(n.face), ' '],
          n.text,
        )
      ),
      toasts,
    )
  let toast = (
    text: string,
    how: { tone?: Tone; rarity?: Rarity; face?: string } = {},
  ) => {
    let n: Note = { id: ++noted, text, ...how }
    notes = [...notes, n].slice(-3)
    drawNotes()
    setTimeout(() => {
      n.out = true
      drawNotes()
    }, 2600)
    setTimeout(() => {
      notes = notes.filter((m) => m != n)
      drawNotes()
    }, 3200)
  }

  // The tray's round buttons, and with a keyboard their keys; one that opens
  // a panel is on while it is open. Full screen, where the browser offers
  // it, comes last.
  let orbs: Record<string, Orb> = {}
  let opens: [Orb, Page][] = []
  let screen: ReturnType<typeof fullscreen> = null
  let drawTray = () =>
    paint(trayBox, [orbs, screen?.on, screen?.busy], () => [
      Object.entries(orbs).map(([name, o]) =>
        h(
          ValeOrb,
          {
            key: name,
            'data-orb': name,
            label: heard(o.tip),
            ...tipProps(o.tip),
            ...o.marks,
            onClick: o.press,
          },
          mark(o.glyph),
          o.tip.key && h(ValeKeycap, { keycap: o.tip.key }),
        )
      ),
      screen && h(ValeOrb, {
        key: 'screen',
        label: screen.on ? 'Leave full screen' : 'Full screen',
        ...tipProps({ name: screen.on ? 'Leave full screen' : 'Full screen' }),
        selected: screen.on,
        disabled: screen.busy,
        onClick: screen.toggle,
      }, mark(screen.on ? 'shrink' : 'expand')),
    ])
  let tray = (
    name: string,
    glyph: Glyph,
    t: Tip & { key: string },
    press: () => void,
    page?: Page,
  ) => {
    let o: Orb = { glyph, tip: t, marks: {}, press }
    orbs[name] = o
    if (page) opens.push([o, page])
    return o
  }
  let marked = (o: Orb, m: Marks) => {
    o.marks = { ...o.marks, ...m }
    drawTray()
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
      key: cap(TABS.party.keys[0]),
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
      key: cap(TABS.menu.keys[0]),
      says: 'Sound, the camera, and every key and touch.',
    },
    panel.menu.toggle,
    panel.menu,
  )
  screen = fullscreen(document, (error) => {
    reportError(error)
    toast('The browser could not change full screen.')
  }, drawTray)
  drawTray()
  let opener = (o: Orb, name: string): Opener => ({
    button: trayBox.querySelector<HTMLElement>(`[data-orb=${name}]`)!,
    mark: (m) => marked(o, m),
  })

  // Said once, to a hero by a fire with nothing in hand.
  let nudged = false
  // Arms or armour found since the bag was last open.
  let fresh = false

  // A button for the thumbs, and with a keyboard its key. Its face is drawn
  // once; bar.ts and `work` and `show` below write into it.
  let pad = (a: Action, face: ComponentChildren, t: Tip) => {
    let key = keysOf(a).map(cap)[0]
    let b = el(`Pad Pad-${a}`, 'button')
    render(h(Fragment, {}, face, key && h(ValeKeycap, { keycap: key })), b)
    tip(b, { ...t, key })
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      press(a)
    })
    pads.append(b)
    return b
  }
  let face = (g?: Glyph) =>
    h('span', {
      class: 'Pad_Icon',
      dangerouslySetInnerHTML: g && { __html: glyph(g) },
    })
  // The strike's and the abilities' tips are bar.ts's, which paints them.
  pad('strike', face(), { name: 'Strike' })
  let abilities = (['ability1', 'ability2', 'ability3'] as const).map((a) =>
    pad(a, [
      face(),
      h('b', { class: 'Pad_Left' }),
      h('i', { class: 'Pad_Star' }, '✦'),
    ], { name: '' })
  )
  pad('dodge', face('dodge'), {
    name: 'Dodge',
    says:
      'Roll clear. A bite you roll through leaves the biter open to a great blow.',
  })
  pad('jump', face('jump'), { name: 'Jump' })
  let drinkPad = pad('drink', [face(), h('span', { class: 'Pad_N' })], {
    name: 'Drink a tonic',
  })
  let drinkKey = cap(keysOf('drink')[0])
  let talkPad = pad('talk', face('talk'), {
    name: 'Talk',
    says: 'Talk to whoever is beside you.',
  })
  let gatherPad = pad('gather', face(), { name: 'Gather' })
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

  // What a pad shows that its owner writes in, written only when it changed.
  let was: Record<string, string> = {}
  let put = (key: string, e: HTMLElement, html: string) => {
    if (was[key] == html) return
    was[key] = html
    e.innerHTML = html
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
    orbs: { chat: opener(chat, 'chat'), mic: opener(mic, 'mic') },
    panels: panel,
    /** the strike and the abilities' pads, for the action bar (bar.ts) */
    acts: [pads.querySelector<HTMLElement>('.Pad-strike')!, ...abilities],
    toast,
    /** someone's words, or none */
    talk: (t: Talk | null, answers: Answers = {}) => {
      talk.hidden = !t
      render(t && h(Fragment, {}, talkView(t, answers, hush)), talk)
    },
    get talking() {
      return !talk.hidden
    },
    partyBadge: (n: number) =>
      marked(party, { attention: n > 0 && !panel.party.open }),
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
      mic.glyph = m == 'on' ? 'mic' : 'micOff'
      mic.tip = {
        name: 'Microphone',
        key: micKey,
        says: `${MICS[m]}${input && m == 'on' ? ` · Input: ${input}` : ''}${
          sending ? ' · Voice going out' : ''
        }`,
      }
      marked(mic, {
        selected: m == 'on',
        faded: m == 'denied' || m == 'missing' || m == 'spent',
        live: sending,
      })
    },
    /** paint this frame, the camera looking `facing` degrees from north,
     * following the hero's `followed` tasks (journal.ts `tracked`), the
     * compass pointing to `goal`, where the first of them goes next */
    show: (
      f: Frame,
      here: number,
      clock: Clock,
      facing: number,
      followed: Task[],
      goal: Spot | null,
    ) => {
      let s = f.sheet
      let ails = labels(f.statuses, f.now)
      paint(
        vitals,
        [s.name, s.lvl, s.points, s.xp, s.max, f.vitals.hp, ails],
        () => vitalsView(s, f.vitals.hp, ails),
      )
      paint(
        quest,
        [f.level, followed.map((t) => [t.id, t.title, next(t)])],
        () => trackView(followed, f.level),
      )
      let m = f.foe
      foe.hidden = !m
      if (m) {
        paint(
          foe,
          [m.beast, m.lvl, Math.ceil(m.hp), m.most, s.lvl],
          () => foeView(m, s.lvl),
        )
        foe.classList.toggle('Foe-boss', !!BEASTS[m.beast].combat?.boss)
        foe.classList.toggle('Foe-danger', skull(m.lvl, s.lvl))
      }
      paint(who, [here, clock], () => whoView(here, clock))
      let way = goal ? toward([f.body.x, f.body.z], goal) : undefined
      paint(rose, [facing, way], () => [
        h(ValeCompass, { bearing: facing, destination: way }),
        h(ValeKeycap, { keycap: cap(TABS.map.keys[0]) }),
      ])
      for (let [o, p] of opens) o.marks.selected = p.open
      // Arms or armour found mark the bag, until it is opened; points to
      // spend mark the skills. Nothing in hand by a fire: the rack there
      // has arms to try, and the bag calls.
      fresh = !panel.bag.open &&
        (fresh ||
          f.events.some((e) => e.type == 'loot' && ITEMS[e.item]?.slot))
      panel.bag.mark(fresh)
      panel.skills.mark(s.points > 0)
      let bare = f.rack && !s.worn.main
      bag.marks = { ...bag.marks, attention: fresh, calling: bare }
      skills.marks.attention = s.points > 0 && !panel.skills.open
      drawTray()
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
