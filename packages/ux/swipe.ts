/**
 * A finger swiping sideways anywhere on the page opens its sidebar: moving
 * right, the one that comes from the left; moving left, the one from the
 * right. Moving back closes the open one. The sidebar follows the finger and,
 * let go, settles open or shut by how far it came and how fast it was moving,
 * with its own motion (@yaks/ui `Layer`).
 *
 * A sidebar is a `Layer-left` or `Layer-right` with an id and `data-swipe`,
 * opened by the address as its link opens it (`#menu`, replacing the
 * fragment, so no history entry). It is one a swipe may open only while the
 * page shows a link to it: where the page lays it beside itself, or has
 * nothing in it, it has none to show.
 *
 * The gesture leaves alone what is not its own:
 * - its axis is locked once the finger has moved `SLOP`, and a mostly
 *   upright move scrolls the page as ever;
 * - a touch within `EDGE` of the screen's sides is the browser's (iOS
 *   Safari's back and forward);
 * - a field being typed in keeps its touches, to place the caret;
 * - what scrolls sideways under the finger (a carousel, a wide table, a row
 *   of tabs) keeps the swipe while it can still scroll that way.
 *
 * ```ts
 * import { axis, placed, settles } from '@yaks/ux/swipe'
 * import { equal } from '@yaks/testing'
 *
 * equal([axis(4, 2), axis(12, 5), axis(5, 12)], [undefined, 'x', 'y'])
 * // A shut sidebar from the left, 300 wide, dragged 120 right.
 * equal(placed('left', 300, false, 120), -180)
 * equal(settles('left', 300, -180, 0), false)
 * equal(settles('left', 300, -180, 0.5), true)
 * ```
 *
 * @module
 */

/** The side a sidebar comes from. */
export type Edge = 'left' | 'right'

/** How far in from each side of the screen a touch is the browser's, px. */
export let EDGE = 24
/** How far a finger moves before its swipe's axis is locked, px. */
export let SLOP = 10
/** How fast a release settles the way it moves, however far, px/ms. */
export let FLING = 0.3
/** How long the moves a release's speed is read over, ms. */
let RECENT = 100

/** The axis a move of `dx`, `dy` locks to, or none until it is past `SLOP`. */
export let axis = (dx: number, dy: number): 'x' | 'y' | undefined =>
  Math.hypot(dx, dy) < SLOP
    ? undefined
    : Math.abs(dx) > Math.abs(dy)
    ? 'x'
    : 'y'

/** Which of `sidebars` a swipe moving `dx` moves: the open one when it moves
 * toward its edge, or, none open, the one from the side the finger leaves. */
export let moves = <S extends { edge: Edge; open: boolean }>(
  sidebars: S[],
  dx: number,
): S | undefined => {
  let shown = sidebars.find((s) => s.open)
  if (shown) return (shown.edge == 'left') == dx < 0 ? shown : undefined
  return sidebars.find((s) => s.edge == (dx > 0 ? 'left' : 'right'))
}

/** Where a sidebar from `edge`, `width` wide, stands once the finger has
 * moved `dx` from where it touched: 0 open, `width` off its edge shut. */
export let placed = (
  edge: Edge,
  width: number,
  open: boolean,
  dx: number,
): number => {
  let off = edge == 'left' ? -width : width
  let at = (open ? 0 : off) + dx
  return Math.min(Math.max(at, Math.min(off, 0)), Math.max(off, 0))
}

/** Whether a sidebar let go `at` (as `placed`), moving `speed` px/ms,
 * settles open: the way it was flung, or else open past its middle. */
export let settles = (
  edge: Edge,
  width: number,
  at: number,
  speed: number,
): boolean =>
  Math.abs(speed) >= FLING
    ? (edge == 'left') == speed > 0
    : Math.abs(at) < width / 2

/** Whether what is under the finger, `from` or what holds it, scrolls
 * sideways and can still go the way a finger moving `dx` takes it. */
export let kept = (
  from: Element | null,
  dx: number,
  style: (el: Element) => { overflowX: string },
): boolean => {
  for (
    let el = from;
    el && el != el.ownerDocument.body;
    el = el.parentElement
  ) {
    if (el.scrollWidth <= el.clientWidth + 1) continue
    if (!/auto|scroll/.test(style(el).overflowX)) continue
    let room = dx > 0
      ? el.scrollLeft > 0
      : el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    if (room) return true
  }
  return false
}

/** What the gesture reads of the window and moves it with. */
export type Window = Pick<typeof globalThis, 'getComputedStyle'> & {
  innerWidth: number
  location: Pick<Location, 'hash' | 'replace'>
}

type Sidebar = { el: HTMLElement; edge: Edge; open: boolean }

let EDITABLE = 'input, textarea, select, [contenteditable]'

// The page's sidebars a swipe may move now, or none while another layer is
// open over the page.
let sidebars = (doc: Document, win: Window): Sidebar[] => {
  let hash = win.location.hash
  let over = hash.length > 1 ? doc.getElementById(hash.slice(1)) : null
  if (over?.matches('.Layer:not([data-swipe])')) return []
  return [...doc.querySelectorAll<HTMLElement>('.Layer[data-swipe][id]')]
    .map((el) =>
      ({
        el,
        edge: el.classList.contains('Layer-left') ? 'left' : 'right',
        open: el == over,
      }) as Sidebar
    )
    .filter((s) =>
      s.open ||
      [...doc.querySelectorAll(`a[href="#${s.el.id}"]`)]
        .some((a) => a.getClientRects().length > 0)
    )
}

/** Open and close `doc`'s sidebars by a finger's swipe. */
export let swipe = (doc: Document, win: Window): () => void => {
  type Touch = { x: number; y: number; target: Element | null }
  type Drag = Sidebar & { width: number; at: number; recent: number[][] }
  let touch: Touch | undefined
  let drag: Drag | undefined

  let point = (e: TouchEvent) => e.touches[0] ?? e.changedTouches[0]
  let start = (e: TouchEvent) => {
    let p = e.touches[0]
    let target = e.target as Element | null
    touch = e.touches.length != 1 || drag ||
        p.clientX < EDGE || p.clientX > win.innerWidth - EDGE ||
        target?.closest?.(EDITABLE)
      ? undefined
      : { x: p.clientX, y: p.clientY, target }
  }
  let lock = (dx: number) => {
    let s = moves(sidebars(doc, win), dx)
    if (!s || kept(touch!.target, dx, win.getComputedStyle)) return
    let { el, edge, open } = s
    el.style.transition = 'none'
    el.style.translate = open ? '0 0' : edge == 'left' ? '-100% 0' : '100% 0'
    if (!open) win.location.replace(`#${el.id}`)
    let width = el.getBoundingClientRect().width
    return { ...s, width, at: 0, recent: [] }
  }
  let move = (e: TouchEvent) => {
    if (!touch) return
    let p = point(e)
    let dx = p.clientX - touch.x
    if (!drag) {
      let locked = axis(dx, p.clientY - touch.y)
      if (!locked) return
      drag = locked == 'x' ? lock(dx) : undefined
      if (!drag) return void (touch = undefined)
    }
    if (e.cancelable) e.preventDefault()
    drag.at = placed(drag.edge, drag.width, drag.open, dx)
    drag.el.style.translate = `${drag.at}px 0`
    drag.recent = [...drag.recent, [e.timeStamp, p.clientX]]
      .filter(([t]) => t >= e.timeStamp - RECENT)
  }
  let end = () => {
    let d = drag
    touch = drag = undefined
    if (!d) return
    let [first, last] = [d.recent[0], d.recent.at(-1)]
    let took = first && last ? last[0] - first[0] : 0
    let speed = took ? (last![1] - first[1]) / took : 0
    let open = settles(d.edge, d.width, d.at, speed)
    // Handed back to its own motion, which carries it on from the finger.
    d.el.style.removeProperty('translate')
    d.el.style.removeProperty('transition')
    if (!open) win.location.replace('#')
  }

  doc.addEventListener('touchstart', start, { passive: true })
  doc.addEventListener('touchmove', move, { passive: false })
  doc.addEventListener('touchend', end)
  doc.addEventListener('touchcancel', end)
  return () => {
    doc.removeEventListener('touchstart', start)
    doc.removeEventListener('touchmove', move)
    doc.removeEventListener('touchend', end)
    doc.removeEventListener('touchcancel', end)
  }
}

if (typeof document != 'undefined') swipe(document, globalThis)
