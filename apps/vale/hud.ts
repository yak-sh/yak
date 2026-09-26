// Everything on the glass: the hero's card (health, level, the xp to the
// next), the quest being followed, the foe's health, who else is here, the
// bag, the buttons a phone needs, the words of whoever you talk to, and the
// toasts that say what just happened. Each part is written only when what it shows changed.
import type { Action } from './input.ts'
import type { Frame, Sheet } from './play.ts'
import { BEASTS } from './beasts.ts'
import { ITEMS } from './items.ts'
import { LEVELS } from './levels.ts'
import { GIVERS, type Quest } from './quests.ts'
import { need } from './rules.ts'

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
}

/** Build the HUD into `root`. `press` sends a button's action to the game. */
export let hud = (root: HTMLElement, press: (a: Action) => void) => {
  let card = el('Card')
  let quest = el('Track')
  let foe = el('Foe')
  let who = el('Who')
  let bag = el('Bag')
  let keys = el(
    'Keys',
    '<span><kbd>WASD</kbd> move</span><span><kbd>Space</kbd> jump</span>' +
      '<span><kbd>F</kbd> or click: strike</span>' +
      '<span><kbd>Shift</kbd> or right-click: dodge</span><span><kbd>E</kbd> talk</span>' +
      '<span><kbd>C</kbd> camera behind</span>' +
      '<span><kbd>Enter</kbd> chat</span>' +
      '<span><kbd>1</kbd> tonic</span><span>drag: look</span>',
  )
  let pads = el('Pads')
  let toasts = el('Toasts')
  let talk = el('Talk')
  talk.hidden = true
  let faint = el(
    'Faint',
    '<div class=Faint_Card><b>You fainted.</b><span>You will wake by the fire, patched up.</span></div>',
  )
  faint.hidden = true
  let layer = el('Layer')
  let pad = (a: Action, label: string, cls = '') => {
    let b = el(`Pad Pad-${a} ${cls}`, label, 'button')
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      press(a)
    })
    pads.append(b)
    return b
  }
  pad(
    'strike',
    '<svg viewBox="0 0 24 24"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
  )
  pad('jump', '<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg>')
  pad(
    'dodge',
    '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
  )
  let talkPad = pad(
    'talk',
    '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  )
  let drinkPad = pad(
    'drink',
    '<span class=Pad_Icon>🧪</span><span class=Pad_N></span>',
  )
  root.append(
    layer,
    card,
    quest,
    foe,
    who,
    bag,
    keys,
    pads,
    toasts,
    talk,
    faint,
  )

  let was: Record<string, string> = {}
  let put = (key: string, e: HTMLElement, html: string) => {
    if (was[key] == html) return
    was[key] = html
    e.innerHTML = html
  }

  let toast = (text: string, cls = '') => {
    let t = el(`Toast ${cls}`, esc(text))
    toasts.append(t)
    setTimeout(() => t.classList.add('Toast-out'), 2600)
    setTimeout(() => t.remove(), 3200)
    while (toasts.children.length > 4) toasts.firstElementChild?.remove()
  }

  // The quest being followed: one taken, or else one on offer, the nearest
  // giver's first.
  let tracking = (s: Sheet, f: Frame) => {
    let near = new Set(f.givers.map((g) => g.id))
    let open = s.quests.filter((q) => q.state == 'open')
    let q = s.quests.find((q) => q.state == 'taken') ??
      open.find((q) => near.has(q.quest.giver)) ?? open[0]
    if (!q) {
      return '<b>The vale is at peace.</b><span>Every quest is done. Well walked.</span>'
    }
    let giver = GIVERS.find((g) => g.id == q.quest.giver)
    let who = giver?.name ?? 'Someone'
    let where = giver && !near.has(giver.id)
      ? ` in ${LEVELS[giver.level]?.name ?? giver.level}`
      : ''
    if (q.state == 'open') {
      return `<b>${esc(who)} has a job for you</b><span>${
        f.talk?.id == q.quest.giver
          ? 'Say hello.'
          : `Find ${esc(who)}${esc(where)}.`
      }</span>`
    }
    let done = q.have >= q.quest.count
    let what = q.quest.goal == 'slay'
      ? `${BEASTS[q.quest.target]?.name ?? q.quest.target}s felled`
      : `${ITEMS[q.quest.target]?.name ?? q.quest.target} gathered`
    return `<b>${esc(q.quest.title)}</b><span>${
      done
        ? `Done! Back to ${esc(who)}${esc(where)}.`
        : `${what}: ${q.have} / ${q.quest.count}`
    }</span>`
  }

  let stacks = (s: Sheet) => {
    let by = new Map<string, number>()
    for (let h of s.bag) by.set(h.kind, (by.get(h.kind) ?? 0) + h.n)
    return [...by].sort(([a], [b]) => a.localeCompare(b))
  }

  return {
    layer,
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
      talk.innerHTML = `<div class=Talk_Who>${
        esc(t.name)
      }</div>${html}<div class=Talk_Acts>${act}<button class=Btn data-do=close>Farewell</button></div>`
      talk.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          if (b.dataset.do == 'accept') accept()
          if (b.dataset.do == 'hand') handIn()
          talk.hidden = true
        })
      )
    },
    get talking() {
      return !talk.hidden
    },
    /** paint this frame */
    show: (f: Frame, here: number, clock: string) => {
      let s = f.sheet
      let hp = f.vitals.hp
      let from = need(s.lvl), to = need(s.lvl + 1)
      put(
        'card',
        card,
        `<div class=Card_Top><b class=Card_Name>${
          esc(s.name)
        }</b><span class=Card_Lvl>Level ${s.lvl}</span></div>` +
          meter(hp / s.max, 'Bar-hp', `${hp} / ${s.max}`) +
          meter(
            (s.xp - from) / Math.max(1, to - from),
            'Bar-xp',
            `${s.xp - from} / ${to - from} xp`,
          ),
      )
      put('quest', quest, tracking(s, f))
      let m = f.foe
      foe.hidden = !m
      if (m) {
        let b = BEASTS[m.kind]
        put(
          'foe',
          foe,
          `<b>${esc(b.name)}</b><em>Level ${b.lvl}</em>${
            meter(m.hp / m.most, 'Bar-foe', `${Math.ceil(m.hp)} / ${m.most}`)
          }`,
        )
      }
      put(
        'who',
        who,
        `<span class=Who_Dot></span>${here} here<span class=Who_Clock>${clock}</span>`,
      )
      let st = stacks(s)
      put(
        'bag',
        bag,
        st.length
          ? st.map(([k, n]) =>
            `<span class=Bag_Item title="${esc(ITEMS[k]?.name ?? k)}"><i>${
              ITEMS[k]?.icon ?? '•'
            }</i>${n > 1 ? n : ''}</span>`
          ).join('')
          : '<span class=Bag_Empty>Your bag is empty</span>',
      )
      let tonics = st.find(([k]) => k == 'tonic')?.[1] ?? 0
      put(
        'tonic',
        drinkPad.querySelector('.Pad_N')!,
        tonics ? String(tonics) : '',
      )
      drinkPad.classList.toggle('Pad-off', !tonics)
      talkPad.classList.toggle('Pad-off', !f.talk)
      faint.hidden = !f.down
    },
  }
}
