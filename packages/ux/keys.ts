/**
 * The keys that walk a page: vim's, one keymap and one cursor for every door.
 *
 * The **cursor** is the item the keys stand on, a mark of its own
 * (`data-cursor`), never the browser's focus: standing on a field doesn't
 * type into it, and nothing opening or closing moves it. In normal mode h, j,
 * k and l move it to the item left of, below, above or right of where it
 * stands; gg and G to the first and the last; Enter or Space presses the item
 * (a link opens, a button presses); H and L go back and forward. An **item**
 * is anything a person can press or type into.
 *
 * Insert mode is the browser's focus in a field: i, or Enter on a field,
 * gives the item under the cursor the focus to type into, and every key is
 * the field's until Esc leaves it, the cursor still on it.
 *
 * A **layer** is what floats over the page: a peek, a menu, a popover, a
 * dialog (`role="dialog"`, `role="menu"`, `aria-modal`). The front-most one
 * takes the keys: the cursor walks only its items, and Esc or q sends it
 * `cancel`, which a layer answers by closing, and the cursor goes back to
 * what it stood on when the layer opened. Without a layer the keys walk the
 * whole surface, the sidebar beside the page included.
 *
 * A browser hears the keys as it hears any, and @yaks/tui's document
 * dispatches the same keydown, measures what it painted, and presses and
 * focuses as a browser does, so one `walk` walks a page in either.
 *
 * The core is pure: `chord` reads keys into moves, and `land` picks the item
 * a move lands on from where the items sit. `walk` is the boundary that reads
 * the document and moves the cursor.
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
  | 'insert'
  | 'close'

/** The keymap: a chord typed in normal mode, and its move. */
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
  ' ': 'open',
  i: 'insert',
  Escape: 'close',
  q: 'close',
}

/** The keymap as a keybinding card reads it. */
export let walkKeys: { keys: string[]; about: string }[] = [
  {
    keys: ['h', 'j', 'k', 'l'],
    about: 'move the cursor to the item left, below, above or right',
  },
  { keys: ['gg', 'G'], about: 'move the cursor to the first or the last item' },
  {
    keys: ['Enter', 'Space'],
    about: 'press the item: a link opens, a button presses, a field types',
  },
  { keys: ['i'], about: 'type into the item: insert mode, until Esc' },
  { keys: ['Esc', 'q'], about: 'close the peek, menu or popover in front' },
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

// What a person can press or type into; what floats over the page; the
// cursor's mark.
let reach = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  '[tabindex]',
  '[contenteditable]',
  '[role=button]',
  '[role=link]',
  '[role=option]',
  '[role=menuitem]',
  '[role=textbox]',
].join(', ')
let layers = '[role=dialog], [role=menu], [aria-modal=true]'
let mark = 'data-cursor'
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

// Whether an item is typed into once entered: a field, or text typed over in
// place (`role="textbox"`), which opens as a double press opens it.
let editable = (n: Element) => typing(n) || n.matches('[role=textbox]')

let shown = (n: Element) =>
  (n as { checkVisibility?: () => boolean }).checkVisibility?.() ?? true

/** The items under `root` the cursor stands on, in reading order: what can
 * be pressed or typed into, and is shown. */
export let items = (root: Element): Element[] =>
  [...root.querySelectorAll(reach)].filter((n) =>
    !n.hasAttribute('disabled') && n.getAttribute('tabindex') != '-1' &&
    n.getAttribute('contenteditable') != 'false' && shown(n)
  )

/** The front-most layer in `surface`'s document: the last shown in reading
 * order, as what opens later floats over what opened before. */
export let front = (surface: Element): Element | undefined => {
  let top = surface
  while (top.parentElement) top = top.parentElement
  return [...top.querySelectorAll(layers)].filter(shown).at(-1)
}

let box = (n: Element): Box | undefined => {
  let r = n.getBoundingClientRect?.()
  return r && (r.width > 0 || r.height > 0) ? r : undefined
}

let view = (): Box | undefined =>
  typeof innerHeight == 'number' && innerHeight > 0
    ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    : undefined

// The item whose box holds where the cursor last stood: a cursor whose
// element was drawn anew stays where it was.
let near = (boxes: (Box | undefined)[], was: Box) => {
  let x = (was.left + was.right) / 2, y = (was.top + was.bottom) / 2
  return boxes.findIndex((b) =>
    !!b && b.left <= x && x <= b.right && b.top <= y && y <= b.bottom
  )
}

// Send `n` an event made by its own window, as its document takes only its
// own (a terminal's document has no window, and takes any).
let send = (n: Element, type: string, init: EventInit) => {
  let view = n.ownerDocument?.defaultView as typeof globalThis | null
  n.dispatchEvent(new (view?.Event ?? Event)(type, init))
}

// Enter an item: type into a field, choose in a select, open text typed over
// in place as a double press does, press anything else.
let enter = (n: Element) => {
  let el = n as HTMLElement
  if (typing(n) || n.matches('select')) return el.focus()
  if (n.matches('[role=textbox]')) {
    return send(n, 'dblclick', { bubbles: true })
  }
  el.click()
}

/** The walk over a surface (the app's frame: the sidebar and the page):
 * `key` hears keydowns, and `point` hears presses, which carry the cursor,
 * unmarked, to the item pressed. A walk from nowhere starts in `start` (the
 * page) when there is one. A key someone took before it, a key with Ctrl,
 * Alt or Meta, and every key while a field is typed into pass by. */
export let walk = (o: {
  surface: () => Element | null | undefined
  start?: () => Element | null | undefined
  back?: () => void
  forward?: () => void
}): { key: (e: KeyboardEvent) => void; point: (e: Event) => void } => {
  let pending = ''
  let at: Element | undefined
  let was: Box | undefined
  let stack: { layer: Element; opener?: Element }[] = []

  let put = (n?: Element) => {
    at?.removeAttribute(mark)
    at = n
    if (!n) return
    n.setAttribute(mark, '')
    was = box(n) ?? was
    n.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  // The front layer. One that closed gives the cursor back to what it stood
  // on when it opened, and one newly in front remembers that.
  let settle = (surface: Element) => {
    let top = front(surface)
    while (stack.length && !stack.at(-1)!.layer.isConnected) {
      let { opener } = stack.pop()!
      if (!at?.isConnected) put(opener)
    }
    if (top && stack.at(-1)?.layer != top) {
      stack.push({ layer: top, opener: at })
    }
    return top
  }

  // An item drawn anew as it closes (text typed over in place is) keeps the
  // cursor: it goes to what now stands where it stood.
  let heal = () => {
    let surface = o.surface()
    if (!surface || !was || at?.isConnected != false) return
    let list = items(front(surface) ?? surface)
    let i = near(list.map(box), was)
    if (i >= 0) put(list[i])
  }

  let current = (list: Element[]) =>
    at?.isConnected ? list.indexOf(at) : was ? near(list.map(box), was) : -1

  let move = (root: Element, i: number, way: Way | 'first' | 'last') => {
    let list = items(root)
    let page = i < 0 && root == o.surface() && o.start?.()
    let from = page ? items(page) : list
    let to = land(from.map(box), page ? -1 : i, way, view())
    if (to != null && from[to] != list[i]) put(from[to])
  }

  let key = (e: KeyboardEvent) => {
    if (held.includes(e.key)) return
    let mine = !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey
    if (!mine || typing(e.target)) {
      pending = ''
      // Esc leaves insert mode, the cursor where it was typed: the walk takes
      // it, so a layer the field is in stays up.
      if (mine && e.key == 'Escape') {
        e.preventDefault()
        put(e.target as Element)
        setTimeout(heal)
      }
      return
    }
    let read = chord(pending, e.key)
    pending = read.pending
    if (pending) return e.preventDefault()
    let way = read.move
    if (way == 'back' || way == 'forward') {
      e.preventDefault()
      return o[way]?.()
    }
    let surface = way && o.surface()
    if (!way || !surface) return
    let top = settle(surface)
    let root = top ?? surface
    let list = items(root)
    let i = current(list)
    if (way == 'close') {
      if (!top) return
      e.preventDefault()
      send(top, 'cancel', { cancelable: true })
      return put(stack.pop()?.opener)
    }
    if (way == 'open') {
      if (i < 0) return
      e.preventDefault()
      enter(list[i])
      // A choice that closes its layer hands the cursor back once it has.
      if (top) setTimeout(() => settle(surface))
      return
    }
    e.preventDefault()
    if (way != 'insert') return move(root, i, way)
    let field = [...list.slice(Math.max(i, 0)), ...list].find(editable)
    if (field) put(field), enter(field)
  }

  let point = (e: Event) => {
    let hit = (e.target as Element | null)?.closest?.(reach) ?? undefined
    at?.removeAttribute(mark)
    at = hit
    was = hit && box(hit)
  }

  return { key, point }
}
