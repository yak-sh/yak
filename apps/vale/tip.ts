// The tips: what a button does, beside it while a mouse rests on it, or
// while a thumb holds it (a long press), since a phone has no hover. A thing
// says its tip in its attributes, `data-tip` and the rest (`tipped` writes
// them into markup, `tip` onto an element), so a tile drawn as HTML and a
// button built in code tip the same way, and the words are there for a
// screen reader too. One tip shows at a time, over everything on the glass,
// beside its thing on the side with room (`place`), and is written again if
// its thing's tip changes while it shows (an ability's, as skills are
// learned). A long press that showed a tip is not also a tap. A thing with
// more to show than words has a card, which whoever drew it draws in the tip
// in place of them when the tip shows (`cards`): a piece of gear, beside what
// is worn. It is asked for then, so a sheet of many things draws none until
// one is looked at. A sheet drawn again while a tip waits to show (a station
// filling its button as the hero works) puts a new thing where the old one
// was, and the tip shows over that.

/** What a tip says: its name, the key that does the same, a note in small
 * (an ability's cooldown), and what it does. */
export type Tip = {
  name: string
  key?: string
  note?: string
  says?: string
}

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// Each part's attribute, and what a screen reader hears.
let ATTRS: [keyof Tip, string][] = [
  ['name', 'data-tip'],
  ['key', 'data-tip-key'],
  ['note', 'data-tip-note'],
  ['says', 'data-tip-says'],
]
let heard = (t: Tip) => [t.name, t.note, t.says].filter(Boolean).join('. ')

/** A tip as attributes, for markup.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   tipped({ name: 'Iron sword', note: 'Sword · tier 2' }),
 *   ' data-tip="Iron sword" data-tip-note="Sword · tier 2" aria-label="Iron sword. Sword · tier 2"',
 * )
 * ```
 */
export let tipped = (t: Tip): string =>
  ATTRS.map(([k, a]) => t[k] ? ` ${a}="${esc(t[k])}"` : '').join('') +
  ` aria-label="${esc(heard(t))}"`

/** Give `e` its tip, in place of any it had. Only what changed is written,
 * so a tip showing is written again only when its words change. */
export let tip = (e: HTMLElement, t: Tip) => {
  let set = (a: string, v?: string) =>
    v
      ? e.getAttribute(a) != v && e.setAttribute(a, v)
      : e.hasAttribute(a) && e.removeAttribute(a)
  for (let [k, a] of ATTRS) set(a, t[k])
  set('aria-label', heard(t))
}

/** Draw the cards of the things in `box`: as a tip is about to show over
 * one, `card` gives what the tip shows in place of its words, or nothing to
 * keep them. A screen reader still hears the words. */
export let cards = (
  box: HTMLElement,
  card: (e: Element) => string | undefined,
) =>
  box.addEventListener('tipcard', (ev) => {
    if (ev instanceof CustomEvent && ev.target instanceof Element) {
      ev.detail.card = card(ev.target)
    }
  })

// What the things around `e` would have its tip show in place of its words.
let cardOf = (e: Element): string | undefined => {
  let detail: { card?: string } = {}
  e.dispatchEvent(new CustomEvent('tipcard', { bubbles: true, detail }))
  return detail.card
}

let read = (e: Element): Tip => ({
  name: e.getAttribute('data-tip') ?? '',
  key: e.getAttribute('data-tip-key') ?? undefined,
  note: e.getAttribute('data-tip-note') ?? undefined,
  says: e.getAttribute('data-tip-says') ?? undefined,
})

type Box = { x: number; y: number; w: number; h: number }

/** Where a tip `w` by `h` goes beside the thing at `r`, `gap` from it, kept
 * inside `room`: to the side of a thing near the room's left or right edge,
 * else above it, or below where there is no room above.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let room = { x: 0, y: 0, w: 1000, h: 800 }
 * // In the middle, low down: above it, centred.
 * assertEquals(place({ x: 480, y: 700, w: 40, h: 40 }, 200, 60, room, 8), { x: 400, y: 632 })
 * // At the top: below it.
 * assertEquals(place({ x: 480, y: 10, w: 40, h: 40 }, 200, 60, room, 8), { x: 400, y: 58 })
 * // At the right edge: to its left, and kept inside the room.
 * assertEquals(place({ x: 950, y: 5, w: 40, h: 40 }, 200, 60, room, 8), { x: 742, y: 0 })
 * ```
 */
export let place = (r: Box, w: number, h: number, room: Box, gap: number) => {
  let cx = r.x + r.w / 2, cy = r.y + r.h / 2
  let [x, y] = cx > room.x + room.w * 0.8
    ? [r.x - gap - w, cy - h / 2]
    : cx < room.x + room.w * 0.2
    ? [r.x + r.w + gap, cy - h / 2]
    : r.y - gap - h >= room.y
    ? [cx - w / 2, r.y - gap - h]
    : [cx - w / 2, r.y + r.h + gap]
  let fit = (v: number, lo: number, span: number) =>
    Math.round(Math.max(lo, Math.min(lo + span, v)))
  return { x: fit(x, room.x, room.w - w), y: fit(y, room.y, room.h - h) }
}

// How long a mouse rests before a tip shows, and how long a thumb holds; how
// far a thumb may wander and still be holding; and how long a tip stays
// once the thumb lifts.
let REST = 250
let HOLD = 450
let WANDER = 10
let LINGER = 1200

/** Show tips over `glass`. */
export let tips = (glass: HTMLElement) => {
  let box = document.createElement('div')
  box.className = 'Tip'
  box.hidden = true
  box.setAttribute('role', 'tooltip')
  glass.append(box)
  let on: Element | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let watch = new MutationObserver(() => on && draw(on))

  let draw = (e: Element) => {
    let t = read(e)
    let card = cardOf(e)
    box.classList.toggle('Tip-card', !!card)
    box.innerHTML = card ??
      `<div class=Tip_Head><b>${esc(t.name)}</b>${
        t.key ? `<kbd class=Key>${esc(t.key)}</kbd>` : ''
      }</div>${t.note ? `<small class=Tip_Note>${esc(t.note)}</small>` : ''}${
        t.says ? `<p class=Tip_Says>${esc(t.says)}</p>` : ''
      }`
    let s = getComputedStyle(glass)
    let px = (v: string) => parseFloat(v) || 0
    let room = {
      x: px(s.paddingLeft),
      y: px(s.paddingTop),
      w: innerWidth - px(s.paddingLeft) - px(s.paddingRight),
      h: innerHeight - px(s.paddingTop) - px(s.paddingBottom),
    }
    let r = e.getBoundingClientRect()
    let at = place(
      { x: r.x, y: r.y, w: r.width, h: r.height },
      box.offsetWidth,
      box.offsetHeight,
      room,
      px(s.rowGap),
    )
    box.style.translate = `${at.x}px ${at.y}px`
  }
  let show = (e: Element) => {
    clearTimeout(timer)
    on = e
    box.hidden = false
    draw(e)
    watch.disconnect()
    watch.observe(e, { attributeFilter: ATTRS.map(([, a]) => a) })
  }
  let hide = () => {
    clearTimeout(timer)
    on = null
    box.hidden = true
    watch.disconnect()
  }
  let later = (ms: number, f: () => void) => {
    clearTimeout(timer)
    timer = setTimeout(f, ms)
  }
  let tipOf = (t: EventTarget | null) =>
    t instanceof Element ? t.closest('[data-tip]') : null
  // The thing `t` was, at the point the pointer came to it: itself, or what
  // was drawn there in its place.
  let still = (t: Element, x: number, y: number) =>
    t.isConnected ? t : tipOf(document.elementFromPoint(x, y))

  // A mouse: a tip after it rests on a thing, at once if one already shows.
  glass.addEventListener('pointerover', (e) => {
    if (e.pointerType == 'touch') return
    let t = tipOf(e.target)
    if (t == on) return
    if (!t) return hide()
    let x = e.clientX, y = e.clientY
    if (on) show(t)
    else {
      later(REST, () => {
        let now = still(t, x, y)
        if (now) show(now)
      })
    }
  })
  glass.addEventListener('pointerout', (e) => {
    if (e.pointerType != 'touch' && !tipOf(e.relatedTarget)) hide()
  })

  // A thumb: a tip once it has held a thing a moment without wandering off,
  // until a little after it lifts. The tap it would have been is let go.
  let held: { t: Element; x: number; y: number; shown: boolean } | null = null
  glass.addEventListener('pointerdown', (e) => {
    if (e.pointerType != 'touch') return hide()
    let t = tipOf(e.target)
    hide()
    held = t ? { t, x: e.clientX, y: e.clientY, shown: false } : null
    if (t) {
      later(HOLD, () => {
        let now = held?.t == t && still(t, held.x, held.y)
        if (held && now) {
          held = { ...held, t: now, shown: true }
          show(now)
        }
      })
    }
  }, true)
  glass.addEventListener('pointermove', (e) => {
    if (!held || held.shown || e.pointerType != 'touch') return
    if (Math.hypot(e.clientX - held.x, e.clientY - held.y) > WANDER) {
      held = null
      clearTimeout(timer)
    }
  }, true)
  let lift = () => {
    if (held?.shown) {
      let t = held.t
      let swallow = (c: Event) => {
        if (c.target instanceof Node && t.contains(c.target)) {
          c.stopPropagation()
          c.preventDefault()
        }
      }
      addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => removeEventListener('click', swallow, true), 400)
      later(LINGER, hide)
    } else clearTimeout(timer)
    held = null
  }
  glass.addEventListener('pointerup', lift, true)
  glass.addEventListener('pointercancel', lift, true)
  // A long press asks the browser for its own menu; a thing with a tip
  // answers with the tip instead.
  glass.addEventListener('contextmenu', (e) => {
    if (tipOf(e.target)) e.preventDefault()
  })
}
