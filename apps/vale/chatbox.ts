// The chat box on the glass: the last lines said in the level the hero is in,
// each fading a while after it was said and all shown while the box is open,
// the line being written (Enter opens it, or the tray's chat button), and the
// words over the heads of whoever said them nearby. A guest reads, and is
// asked to sign in to speak. Which lines count is chat.ts's rule over the rows
// the store stamped; this only draws them.
//
// A line goes to the store with the rows the hero earns (net.ts `keep`), so
// saying something costs no write of its own. Lines go one at a time, further
// apart than `keep` sends and than the store's pace for them (vocab.json), so
// no two share a write, which the store would refuse whole. Until the store has
// a line it shows here at once, marked as waiting, and floats over the
// speaker's own head.
//
// A line said beside a villager is said to them too (village.ts): the same
// row asks them to answer, and what they answer floats over their head and
// joins the log like anybody's line.
import type { Watch } from '@yaks/client'
// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import {
  bubbles,
  clean,
  EARSHOT,
  earshot,
  heard,
  type Line,
  lineOf,
  MAX,
  writer,
} from './chat.ts'
import type { overlay } from './fx.ts'
import type { Me, Net } from './net.ts'
import type { Frame } from './play.ts'
import type { Village } from './village.ts'

// Lines in the log, and lines the store is asked for before the rule.
let SHOWN = 6
let ASKED = 40

// How long a line waits after the last one went, in ms: longer than net.ts's
// pace, so each goes in a write of its own.
let GAP = 2200

// How long a line may wait for the store before it is given up, in ms.
let LOST = 20000

// How long the ask to sign in stays, in ms.
let ASKING = 6000

// How long a line stays in the log once said, and then how long it takes to
// fade, in ms. The fade is chat.css's, run by the compositor.
let STAY = 9000
let FADE = 3000

// A line of mine, and the rest of its row when it is said to a villager.
type Said = Line & { level: string; to: Record<string, unknown> | null }

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
  let e = document.createElement(tag)
  e.className = cls
  return e
}

/** Build the chat box into `glass`, opened by `opener`, and the bubbles into
 * `marks`. */
export let chatbox = (
  glass: HTMLElement,
  opener: HTMLElement,
  net: Net,
  marks: ReturnType<typeof overlay>,
  folk: Village,
) => {
  let box = el('div', 'Chat')
  let log = el('ol', 'Chat_Log')
  let form = el('form', 'Chat_Say')
  let input = el('input', 'Chat_Input')
  input.maxLength = MAX
  input.placeholder = 'Say something…'
  input.enterKeyHint = 'send'
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'Say something to everyone here')
  form.append(input)
  form.hidden = true
  let ask = el('a', 'Btn Btn-small Chat_Ask')
  ask.textContent = 'Sign in to chat'
  ask.hidden = true
  box.append(log, form, ask)
  box.style.setProperty('--fade', `${FADE}ms`)
  glass.append(box)

  let me: Me | null = null
  let speaks = () => !!me?.person && me.writes

  // What the store holds: the lines said in this level, newest first, and
  // who made each hero, which the rule asks.
  let level = ''
  let lines: Watch | null = null
  let makers = new Map<string, string>()
  let asking = new Set<string>()
  let watch = (q: string): Watch | null => {
    try {
      return net.client.watch(q)
    } catch (e) {
      console.warn('mossvale chat:', e)
      return null
    }
  }
  let follow = (id: string) => {
    lines?.close()
    level = id
    lines = watch(
      `.chat.level=${
        JSON.stringify(id)
      }&?doc&?created&.order=-created.at&.limit=${ASKED}`,
    )
  }
  let owner = (hero: string) =>
    makers.get(hero) || writer(net.client.ent(hero)) || null
  let askMaker = (hero: string) => {
    if (makers.has(hero) || asking.has(hero) || asking.size >= 2) return
    asking.add(hero)
    void net.about(hero).then(({ by }) => makers.set(hero, by)).finally(
      () => asking.delete(hero),
    )
  }

  // My lines: those still to go, one each `GAP`, and those gone that the
  // store has not answered with yet.
  let outbox: Said[] = []
  let waiting: Said[] = []
  let went = -Infinity
  let send = () => {
    let t = performance.now()
    if (!outbox.length || t - went < GAP) return
    let l = outbox.shift()!
    went = t
    waiting.push(l)
    net.keep({
      entity: { eid: l.eid },
      chat: { level: l.level, player: l.player },
      doc: { body: l.text },
      ...l.to,
    })
  }

  // When a line starts to fade: `STAY` after it was said, and never before
  // the box last closed, so what the open box showed fades away gently.
  let shut = -Infinity
  let fades = (l: Line) => Math.max(l.at + STAY, shut)

  let open = false
  let asked = 0
  let show = () => {
    if (!speaks()) {
      if (me?.signIn) ask.href = me.signIn
      ask.hidden = false
      asked = performance.now()
      return
    }
    open = true
    form.hidden = false
    opener.classList.add('Orb-on')
    box.classList.add('Chat-open')
    input.focus()
  }
  let hide = () => {
    if (!open) return
    open = false
    shut = net.now()
    form.hidden = true
    opener.classList.remove('Orb-on')
    box.classList.remove('Chat-open')
    input.blur()
  }
  addEventListener('keydown', (e) => {
    if (e.key != 'Enter' || open || glass.hidden) return
    if (e.target instanceof HTMLInputElement) return
    // Kept from the input it is about to focus, which would send it.
    e.preventDefault()
    show()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key == 'Escape') hide()
  })
  input.addEventListener('blur', hide)
  // The opener keeps the line's focus, so a second tap folds it away.
  opener.addEventListener('pointerdown', (e) => e.preventDefault())
  opener.addEventListener('click', () => open ? hide() : show())
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    let text = clean(input.value)
    input.value = ''
    hide()
    let hero = net.hero
    if (!text || !hero || !level || !speaks()) return
    outbox.push({
      eid: crypto.randomUUID(),
      player: hero,
      by: me?.person ?? '',
      text,
      at: net.now(),
      level,
      to: folk.to(text),
    })
  })

  // The log, written only when what it shows changed. A line is drawn part
  // way through its arrival and its fade, however late it is drawn; the open
  // box shows every line whole.
  let drawn = ''
  let draw = (shown: Line[], mine: Set<string>, now: number) => {
    let rows = shown.map((l) => {
      let p = net.who(l.player)
      let v = folk.who(l.player)
      return {
        eid: l.eid,
        name: v?.name ?? p?.name ?? 'Wanderer',
        tint: v?.tint ?? p?.tint ?? '#dff5c8',
        text: l.text,
        wait: mine.has(l.eid),
        at: l.at,
        fades: fades(l),
      }
    })
    let key = JSON.stringify([open, rows])
    if (key == drawn) return
    drawn = key
    log.replaceChildren(...rows.map((r) => {
      let li = el('li', `Chat_Line${r.wait ? ' Chat_Line-wait' : ''}`)
      if (!open) {
        li.style.animationDelay = `${Math.min(0, r.at - now).toFixed(0)}ms, ${
          (r.fades - now).toFixed(0)
        }ms`
      }
      let name = el('b', 'Chat_Name')
      name.textContent = r.name
      name.style.setProperty('--tint', r.tint)
      li.append(name, document.createTextNode(r.text))
      return li
    }))
  }

  // A bubble's words, made once, so its fade starts from when it was said
  // however late the line arrived.
  let said = new Map<string, string>()
  let bubble = (l: Line, now: number) => {
    let html = said.get(l.eid)
    if (!html) {
      if (said.size > 200) said.clear()
      html = `<span class=Bubble style="animation-delay:${
        Math.min(0, l.at - now).toFixed(0)
      }ms">${esc(l.text)}</span>`
      said.set(l.eid, html)
    }
    return html
  }

  return {
    /** the keyboard is the chat's while a line is being written */
    get typing() {
      return open
    },
    /** who is looking: a person signed in speaks, a guest is asked to */
    me: (who: Me) => {
      me = who
      opener.classList.toggle('Orb-off', !speaks())
    },
    /** this frame: the level's lines, and the words over heads near me */
    tick: (f: Frame, head: (eid: string) => THREE.Vector3 | null) => {
      let hero = net.hero
      if (!hero) return
      if (f.level != level) follow(f.level)
      if (!ask.hidden && performance.now() - asked > ASKING) ask.hidden = true
      send()
      let now = net.now()
      let held = lines?.value ?? []
      for (let b of held) {
        let l = lineOf(b)
        if (l) askMaker(l.player)
      }
      // A line of mine is in the page's graph the moment it goes, but it is
      // not the store's until the store has stamped who wrote it.
      let there = new Set(
        held.filter((b) => writer(b)).map((b) => b.entity.eid),
      )
      waiting = waiting.filter((l) => !there.has(l.eid) && now - l.at < LOST)
      let mine = [...waiting, ...outbox].filter((l) => l.level == level)
      let shown = [
        ...[
          ...heard(held.flatMap((b) => lineOf(b) ?? []), owner),
          ...folk.lines(),
        ]
          .sort((a, b) => a.at - b.at),
        ...mine,
      ]
      let recent = shown.slice(-SHOWN)
      draw(
        open ? recent : recent.filter((l) => now < fades(l) + FADE),
        new Set(mine.map((l) => l.eid)),
        now,
      )
      let to = folk.near()
      let hint = to ? `Say something to ${to}…` : 'Say something…'
      if (input.placeholder != hint) input.placeholder = hint
      let near = new Set([
        hero,
        ...earshot(f.body, f.others),
        ...f.givers.filter((g) => g.near <= EARSHOT).map((g) => g.id),
      ])
      for (let l of bubbles(shown, near, now)) {
        let at = head(l.player)
        if (at) {
          marks.plate(`said:${l.eid}`, at, bubble(l, now), 'Plate Plate-said')
        }
      }
    },
  }
}
