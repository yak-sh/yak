// The chat box on the glass: the last lines said in the level the hero is in,
// the line being written (Enter opens it, or the 💬 button), and the words
// over the heads of whoever said them nearby. A guest reads, and is asked to
// sign in to speak. Which lines count is chat.ts's rule over the rows the
// store stamped; this only draws them.
//
// A line goes to the store with the rows the hero earns (net.ts `keep`), so
// saying something costs no write of its own. Lines go one at a time, further
// apart than `keep` sends, so no two share a write, and the rule would hear
// only the first of two that did. Until the store has a line it shows here at
// once, marked as waiting, and floats over the speaker's own head.
import type { Watch } from '@yaks/client'
// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import {
  bubbles,
  clean,
  earshot,
  heard,
  type Line,
  lineOf,
  MAX,
  writer,
} from './chat.ts'
import type { overlay } from './fx.ts'
import { comp, type Me, type Net, str } from './net.ts'
import type { Frame } from './play.ts'

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

type Said = Line & { level: string }

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
  let e = document.createElement(tag)
  e.className = cls
  return e
}

/** Build the chat box into `glass`, the bubbles into `marks`. */
export let chatbox = (
  glass: HTMLElement,
  net: Net,
  marks: ReturnType<typeof overlay>,
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
  let button = el('button', 'Chat_Open')
  button.type = 'button'
  button.textContent = '💬'
  button.title = 'Chat (Enter)'
  let ask = el('a', 'Chat_Ask')
  ask.textContent = 'Sign in to chat'
  ask.hidden = true
  box.append(log, form, button, ask)
  glass.append(box)

  let me: Me | null = null
  let speaks = () => !!me?.person && me.writes

  // What the store holds: the lines said in this level, newest first, and
  // who made each hero, which the rule asks.
  let level = ''
  let lines: Watch | null = null
  let makers: Watch | null = null
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
    makers ??= watch('.player&?created')
  }
  let owner = (hero: string) => writer(net.client.ent(hero)) || null

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
    })
  }

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
    button.hidden = true
    box.classList.add('Chat-open')
    input.focus()
  }
  let hide = () => {
    if (!open) return
    open = false
    form.hidden = true
    button.hidden = false
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
  button.addEventListener('click', show)
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
    })
  })

  // The log, written only when what it shows changed.
  let drawn = ''
  let draw = (shown: Line[], mine: Set<string>) => {
    let rows = shown.map((l) => {
      let p = comp(net.client.ent(l.player), 'player')
      return {
        eid: l.eid,
        name: str(p.name, 'Wanderer'),
        tint: str(p.tint, '#dff5c8'),
        text: l.text,
        wait: mine.has(l.eid),
      }
    })
    let key = JSON.stringify(rows)
    if (key == drawn) return
    drawn = key
    log.replaceChildren(...rows.map((r) => {
      let li = el('li', `Chat_Line${r.wait ? ' Chat_Line-wait' : ''}`)
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
      box.classList.toggle('Chat-guest', !speaks())
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
      // A line of mine is in the page's graph the moment it goes, but it is
      // not the store's until the store has stamped who wrote it.
      let there = new Set(
        held.filter((b) => writer(b)).map((b) => b.entity.eid),
      )
      waiting = waiting.filter((l) => !there.has(l.eid) && now - l.at < LOST)
      let mine = [...waiting, ...outbox].filter((l) => l.level == level)
      let shown = [
        ...heard(held.flatMap((b) => lineOf(b) ?? []), owner),
        ...mine,
      ]
      draw(shown.slice(-SHOWN), new Set(mine.map((l) => l.eid)))
      let near = new Set([hero, ...earshot(f.body, f.others)])
      for (let l of bubbles(shown, near, now)) {
        let at = head(l.player)
        if (at) {
          marks.plate(`said:${l.eid}`, at, bubble(l, now), 'Plate Plate-said')
        }
      }
    },
  }
}
