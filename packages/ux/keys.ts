/**
 * The keys that walk a page: vim's, one keymap and one focus model for every
 * door. h, j, k and l move the focus to the item left of, below, above or
 * right of the one holding it; gg and G to the first and the last; H and L go
 * back and forward; Enter presses an item the platform doesn't press itself;
 * Esc lets go. An item is anything a person can press or type into, and the
 * keys rest while one is being typed into.
 *
 * A browser hears the keys as it hears any, and @yaks/tui's document
 * dispatches the same keydown on the element in focus, measures what it
 * painted, and focuses and reveals as a browser does, so one `walk` listener
 * walks a page in either.
 *
 * The core is pure: `chord` reads keys into moves, and `land` picks the item
 * a move lands on from where the items sit. `walk` is the boundary that reads
 * the document and moves its focus.
 *
 * ```ts
 * import { land } from '@yaks/ux/keys'
 * import { equal } from '@yaks/testing'
 *
 * // Two rows of two: l goes right, j goes down, h from the left edge stays.
 * let at = (left: number, top: number) =>
 *   ({ left, top, right: left + 10, bottom: top + 10 })
 * let page = [at(0, 0), at(20, 0), at(0, 20), at(20, 20)]
 * equal(land(page, 0, 'right'), 1)
 * equal(land(page, 1, 'down'), 3)
 * equal(land(page, 2, 'left'), undefined)
 * ```
 *
 * @module
 */

/** Where an item sits, in its platform's units: pixels, or a terminal's
 * cells. */
export type Box = { left: number; top: number; right: number; bottom: number }

type Way = 'up' | 'down' | 'left' | 'right'

/** What a chord does. */
export type Move =
  | Way
  | 'first'
  | 'last'
  | 'back'
  | 'forward'
  | 'open'
  | 'leave'

/** The keymap: a chord typed where no one is typing, and its move. */
export let keymap: Record<string, Move> = {
  h: 'left',
  j: 'down',
  k: 'up',
  l: 'right',
  gg: 'first',
  G: 'last',
  H: 'back',
  L: 'forward',
  Enter: 'open',
  Escape: 'leave',
}

/** The keymap as a keybinding card reads it, but for Esc, which a door
 * says with whatever else it lets go of. */
export let walkKeys: { keys: string[]; about: string }[] = [
  {
    keys: ['h', 'j', 'k', 'l'],
    about: 'move to the item left, below, above or right',
  },
  { keys: ['gg', 'G'], about: 'move to the first or the last item' },
  {
    keys: ['Enter'],
    about: 'open the item: a link peeks or opens, a button presses',
  },
  { keys: ['H', 'L'], about: 'go back or forward' },
]

/** A key read after the keys still pending: the move a whole chord makes, or
 * the chord begun and still pending. A key that ends no chord starts over. */
/// chord('', 'j') -> {move: 'down', pending: ''}
/// chord('', 'g') -> {pending: 'g'}
/// chord('g', 'g') -> {move: 'first', pending: ''}
/// chord('g', 'G') -> {move: 'last', pending: ''}
/// chord('', 'x') -> {pending: ''}
export let chord = (
  pending: string,
  key: string,
): { move?: Move; pending: string } => {
  let typed = pending + key
  if (Object.hasOwn(keymap, typed)) return { move: keymap[typed], pending: '' }
  if (Object.keys(keymap).some((k) => k != typed && k.startsWith(typed))) {
    return { pending: typed }
  }
  return pending ? chord('', key) : { pending: '' }
}

// Every way read as down: a box turned so the way it is walked runs down the
// page, so one set of rules serves all four.
let turn = (way: Way, b: Box): Box =>
  way == 'down'
    ? b
    : way == 'up'
    ? { left: b.left, right: b.right, top: -b.bottom, bottom: -b.top }
    : way == 'right'
    ? { left: b.top, right: b.bottom, top: b.left, bottom: b.right }
    : { left: b.top, right: b.bottom, top: -b.right, bottom: -b.left }

// The rules Android's FocusFinder walks a screen by. A box lies down from
// another when its top starts lower and its bottom ends lower, so a box
// inside another, or beside it on the same line, never does. One in the beam,
// overlapping it across the way, wins over one outside it, unless that one
// ends before the beam's starts; otherwise the nearer wins, where how far
// down counts thirteen times over how far across. Across is measured start
// to start, not centre to centre as Android does, so a walk down from a wide
// title lands where the next line begins.
let down = (a: Box, b: Box) =>
  (a.top < b.top || a.bottom <= b.top) && a.bottom < b.bottom
let beam = (a: Box, b: Box) => b.right > a.left && b.left < a.right
let gap = (a: Box, b: Box) => Math.max(0, b.top - a.bottom)
let far = (a: Box, b: Box) => Math.max(1, b.bottom - a.bottom)
let across = (a: Box, b: Box) => Math.abs(a.left - b.left)
let weight = (a: Box, b: Box) => 13 * gap(a, b) ** 2 + across(a, b) ** 2
let beats = (a: Box, b: Box, c: Box, sideways: boolean) =>
  beam(a, b) && !beam(a, c) &&
  (a.bottom > c.top || sideways || gap(a, b) < far(a, c))
let better = (a: Box, b: Box, c: Box | undefined, sideways: boolean) =>
  down(a, b) && (
    !c || !down(a, c) || beats(a, b, c, sideways) ||
    !beats(a, c, b, sideways) && weight(a, b) < weight(a, c)
  )

let inside = (b: Box, view?: Box) =>
  !view || b.bottom > view.top && b.top < view.bottom &&
    b.right > view.left && b.left < view.right

/** The item a move lands on from the one at `at` (-1 for none), among items
 * in reading order with where each sits; undefined stays put. An item with no
 * box is out of sight (a terminal paints only what its window shows): a walk
 * up or down that finds nothing in sight reaches it in reading order. From
 * nowhere, a walk starts at the first item in `view`, or the last walking up
 * or left. */
/// land([], -1, 'down') -> undefined
/// land([{left: 0, top: 0, right: 9, bottom: 9}], -1, 'down') -> 0
/// land([{left: 0, top: 0, right: 9, bottom: 9}, undefined], 0, 'down') -> 1
/// land([undefined, undefined, undefined], 1, 'last') -> 2
export let land = (
  boxes: (Box | undefined)[],
  at: number,
  move: Way | 'first' | 'last',
  view?: Box,
): number | undefined => {
  let last = boxes.length - 1
  if (last < 0) return
  if (move == 'first') return 0
  if (move == 'last') return last
  let back = move == 'up' || move == 'left'
  let sideways = move == 'left' || move == 'right'
  let next = at + (back ? -1 : 1)
  let order = !sideways && next >= 0 && next <= last && !boxes[next]
  let here = boxes[at]
  if (at < 0) {
    let seen = boxes.flatMap((b, i) => b && inside(b, view) ? [i] : [])
    return seen.length ? (back ? seen.at(-1) : seen[0]) : back ? last : 0
  }
  if (!here) return order ? next : undefined
  let a = turn(move, here)
  let best: number | undefined
  boxes.forEach((b, i) => {
    let held = best == null ? undefined : turn(move, boxes[best]!)
    if (b && i != at && better(a, turn(move, b), held, sideways)) best = i
  })
  return best ?? (order ? next : undefined)
}

// What a person can press or type into, and what a platform presses itself
// on Enter.
let reach =
  'a[href], button, input, textarea, select, summary, [tabindex], [role=button], [role=link]'
let pressed = 'a[href], button, input, select, textarea, summary'
let buttons = [
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
]
let held = ['Shift', 'Control', 'Alt', 'Meta']

/** Whether `at` is being typed into: a field that takes every printable key,
 * j and k among them. A select, a checkbox or a button lets the keys walk
 * on. */
export let typing = (at: EventTarget | null | undefined): boolean => {
  let el = at as HTMLElement | null | undefined
  if (typeof el?.matches != 'function') return false
  return !!el.isContentEditable || el.matches('textarea') ||
    el.matches('input') && !buttons.includes(el.getAttribute('type') ?? 'text')
}

/** The items under `root` a walk lands on, in reading order: what can be
 * pressed or typed into, and is shown. */
export let items = (root: Element): Element[] =>
  [...root.querySelectorAll(reach)].filter((n) =>
    !n.hasAttribute('disabled') && n.getAttribute('tabindex') != '-1' &&
    ((n as { checkVisibility?: () => boolean }).checkVisibility?.() ?? true)
  )

let box = (n: Element): Box | undefined => {
  let r = n.getBoundingClientRect?.()
  return r && (r.width > 0 || r.height > 0) ? r : undefined
}

let view = (): Box | undefined =>
  typeof innerHeight == 'number' && innerHeight > 0
    ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    : undefined

let show = (n: Element) => {
  let el = n as HTMLElement
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions)
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

/** A keydown listener that walks the items `scope` holds (the page, or what
 * floats over it) by the keymap. A key someone took before it, a key with
 * Ctrl, Alt or Meta, and every key while a field is typed into pass by. */
export let walk = (o: {
  scope: () => Element | null | undefined
  back?: () => void
  forward?: () => void
}): (e: KeyboardEvent) => void => {
  let pending = ''
  return (e) => {
    if (held.includes(e.key)) return
    let mine = !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey &&
      !typing(e.target)
    let read = mine ? chord(pending, e.key) : { pending: '' }
    pending = read.pending
    if (pending) return e.preventDefault()
    let move = read.move
    if (move == 'back' || move == 'forward') {
      e.preventDefault()
      return o[move]?.()
    }
    let root = move && o.scope()
    if (!move || !root) return
    let list = items(root)
    let at = list.indexOf(root.ownerDocument?.activeElement as Element)
    let item = list[at] as HTMLElement | undefined
    if (move == 'leave') return item?.blur()
    if (move == 'open') {
      if (!item || item.matches(pressed)) return
      e.preventDefault()
      return item.click()
    }
    e.preventDefault()
    let to = land(list.map(box), at, move, view())
    if (to != null && to != at) show(list[to])
  }
}
