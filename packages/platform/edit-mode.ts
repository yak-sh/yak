// Edit mode on an app's page: the words a member may type over where they
// stand. public/edit.js draws the pencil and loads this, served at the app's
// `./api/_edit.js` (assets.ts), once it is pressed; a stranger, a guest
// and a sandboxed page are never sent either (apps.ts `editOf`).
//
// Each element naming a snippet (`data-copy`, @yaks/copy) is outlined, and a
// press on one lets the person type over it. What they type is their draft
// at `copy:<key>` (@yaks/draft): kept as they type, there after a reload and
// on their other devices, and shown in place of the page's words while edit
// mode is on. A slot's child (`data-copy-slot`) is not typed over; it holds
// its place in the sentence. While editing, nothing on the page acts on a
// press: links do not go and buttons do not press.
//
// A list (`data-copy-list`) is edited item by item, each of its child
// elements an item of plain text. Enter adds an item after the one typed in,
// drawn as the list's first item was, taking what followed the caret; Backspace
// in an empty item removes it, and so does leaving it empty. An item moves by
// its handle, dragged with a mouse or a finger, or with Alt and an arrow key.
// The list's draft is all its items, at `copy-list:<key>`, and Save sends them
// as one list.
//
// The panel beside the pencil counts the person's changes to this app and
// discards them, which empties each draft (the journal keeps what it held).
// Save sends them to the app's `api/save` (save.ts), which sets them in its
// copy.json and releases it. The page takes them as its own words the moment
// Save is pressed, and the panel says so; the drafts are spent only once the
// save answers, so a save refused or failed puts the page's words back,
// leaves every draft as it was and says why. A Save pressed while one is on
// its way goes after it. Done returns the page to browsing while waiting.
// Once a save answers, the panel says which version
// it made and offers Undo (`api/save/undo`), which takes that release back
// and makes the changes drafts again, as they were before Save. How long the
// answer took is timed as a press is (@yaks/timing), at `report`.
// A page with nothing marked says so, and offers the Operator's chat with the
// ask to mark this page already typed.
import { fill, join, names } from '@yaks/copy'
import { phases } from '@yaks/timing/interaction'

/** What edit mode needs of the person's drafts: the desk client.js gives
 * (`drafts()`, @yaks/draft/browser). */
export type Desk = {
  ready: Promise<void>
  text: (place: string) => string
  type: (place: string, text: string) => void
  spend: (place: string) => Promise<boolean>
  places: () => string[]
  follow: (fn: () => void) => () => void
}

/** Where edit mode draws its panel, and the Operator's chat it offers. */
export type Opts = {
  panel: HTMLElement
  /** The app's address, whose `api/save` Save sends to (`/cookbook/`). */
  at: string
  /** How Save, and a save's time, reach it; the page's own fetch (and
   * beacon) where left out. */
  fetch?: typeof fetch
  /** The Operator's chat for this app (`/manage/<space>?app=<slug>`). */
  ask: string
  /** Where a save's time is sent, as a press's is (page-report.ts
   * `interactions`); none sends nothing. */
  report?: string
  /** Edit mode is over: the person pressed Done. */
  done: () => void
}

/** The place a snippet's draft is typed at, or a list's. */
export let placeOf = (key: string, list = false) =>
  `${list ? 'copy-list' : 'copy'}:${key}`

// The key and kind a place is the draft of; none for another draft.
let parsePlace = (place: string) => {
  for (let list of [false, true]) {
    let at = placeOf('', list)
    if (place.startsWith(at)) return { key: place.slice(at.length), list }
  }
}

/** A list's draft, read back: its items' snippets, or none where the text is
 * not a list. */
export let listOf = (text: string): string[] | null => {
  try {
    let value = JSON.parse(text)
    return Array.isArray(value) && value.every((s) => typeof s == 'string')
      ? value
      : null
  } catch {
    return null
  }
}

/** What a person says the Operator, from a page with nothing marked. */
export let asking = (page: string) =>
  `Move the words on ${page} into copy.json, marking each element with ` +
  'data-copy, so I can change them on the page.'

/** How many changes a count is, as the panel says it. */
export let counted = (n: number) => n == 1 ? '1 change' : `${n} changes`

/** The word for a press where the person is: Tap on a touch screen, Click
 * with a mouse. */
export let pressWord = (win: Pick<Window, 'matchMedia'>) =>
  win.matchMedia?.('(pointer: coarse)').matches ? 'Tap' : 'Click'

/** What the panel says before any change. */
export let hint = (win: Pick<Window, 'matchMedia'>) =>
  `${pressWord(win)} any outlined words to change them.`

/** What the panel says once Save is pressed, before it has answered. */
export let SAVED = 'Saved'

/** What the panel says once Save has answered. */
export let savedAs = (version: number) => `Saved as version ${version}`

/** The point a save's answer is counted as: from the press until it
 * answered, `server` of it the request's own round trip and the rest its
 * wait behind a save before it. */
export let savePoint = (ms: number, server: number) => ({
  page: 'app',
  target: 'saved',
  ms,
  ...phases(ms, 0, server, 0),
})

let EDITING = 'data-yak-editing'
let CHANGED = 'data-yak-changed'
let HANDLE = 'data-yak-handle'
let MOVING = 'data-yak-moving'
let LIST = `[${names.list}]`
let ITEM = `${LIST} > *`
let CSS = `
[${EDITING}] [${names.text}], [${EDITING}] ${ITEM} {
  outline: 1.5px dashed rgb(76 119 62 / 0.75) !important;
  outline-offset: 2px !important;
  cursor: text !important;
}
[${EDITING}] [${names.text}][${CHANGED}],
[${EDITING}] ${LIST}[${CHANGED}] > * {
  outline-color: rgb(201 122 26 / 0.9) !important;
}
@media (hover: hover) and (pointer: fine) {
  [${EDITING}] [${names.text}]:hover, [${EDITING}] ${ITEM}:hover {
    outline-style: solid !important;
  }
}
[${EDITING}] [${names.text}][contenteditable=plaintext-only],
[${EDITING}] [${names.text}][contenteditable=true],
[${EDITING}] ${ITEM}[contenteditable=plaintext-only] {
  outline-style: solid !important;
}
[${EDITING}] [${names.text}] [${names.slot}] {
  cursor: default !important;
}
[${EDITING}] ${ITEM}[${MOVING}] {
  outline-style: solid !important;
  opacity: 0.7 !important;
}
[${HANDLE}] {
  position: absolute !important;
  z-index: 2147483646 !important;
  box-sizing: border-box !important;
  width: 22px !important;
  height: 28px !important;
  margin: 0 !important;
  padding: 4px !important;
  border: 1px solid rgb(76 119 62 / 0.5) !important;
  border-radius: 6px !important;
  background: #fffdf8 radial-gradient(circle, rgb(76 119 62) 1.5px,
    transparent 1.75px) 0 0 / 6px 6px content-box !important;
  box-shadow: 0 1px 3px rgb(82 56 40 / 0.22) !important;
  cursor: grab !important;
  touch-action: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
[${HANDLE}][hidden] { display: none !important }
[${HANDLE}][${MOVING}] { cursor: grabbing !important }
@media (pointer: coarse) {
  [${HANDLE}] {
    width: 30px !important;
    height: 36px !important;
    padding: 8px !important;
  }
}
`
// What a page's own code hears of a press or a keystroke while editing:
// nothing. The words still take the keyboard; only the app's handlers and
// the browser's going and pressing are stopped.
let PRESSES = [
  'pointerdown',
  'mousedown',
  'touchstart',
  'click',
  'dblclick',
  'auxclick',
  'submit',
]
// The presses whose own act is going or pressing, which never happens.
let STOPS = ['click', 'dblclick', 'auxclick', 'submit']
let KEYS = ['keydown', 'keypress', 'keyup', 'beforeinput', 'input']

// An element's own words: the nodes it came with, or once Save has set its
// snippet, none, and it is drawn showing the value.
type Held = { was: Node[] | null; value: string }

/** The snippet an element shows, read from its nodes. */
export let valueOf = (el: Element) =>
  join([...el.childNodes].map((node) => {
    if (node.nodeType == 3) return node.textContent ?? ''
    if (node.nodeType != 1) return ''
    let child = node as Element
    let slot = child.getAttribute(names.slot)
    if (slot != null) return { slot }
    return child.tagName == 'BR' ? '\n' : child.textContent ?? ''
  }))

// A list item's snippet: its words, a line.
let itemValue = (item: Element) => valueOf(item).replace(/\s*\n\s*/g, ' ')

/** A list's items' snippets, as its draft holds them. */
export let listValue = (list: Element) =>
  JSON.stringify([...list.children].map(itemValue))

// A list drawn showing `value`, the items it has kept and each new one drawn
// as `like`.
let drawList = (list: Element, value: string, like: Element) => {
  let want = listOf(value) ?? []
  let have = [...list.children]
  want.forEach((text, i) => {
    let item = have[i] ?? list.appendChild(like.cloneNode(false) as Element)
    if (valueOf(item) != text) draw(item, text)
  })
  for (let item of have.slice(want.length)) item.remove()
}

/** An element drawn showing `value`, its slots' own children kept. */
export let draw = (el: Element, value: string) => {
  let slotted: Record<string, Element> = {}
  for (let child of el.children) {
    let slot = child.getAttribute(names.slot)
    if (slot != null) slotted[slot] = child
  }
  let doc = el.ownerDocument
  el.replaceChildren(
    ...fill(value, slotted).map((part) =>
      typeof part == 'string' ? doc.createTextNode(part) : part
    ),
  )
}

/** Edit mode on `doc`, until `stop()`. */
export let editMode = (doc: Document, drafts: Desk, opts: Opts) => {
  let win = doc.defaultView!
  // What can be typed over: each element showing a snippet, and each list,
  // whose items are its children. A snippet inside a list is the list's.
  let lists = [...doc.querySelectorAll(LIST)].filter((el) =>
    el.firstElementChild && !el.parentElement?.closest(LIST)
  )
  let like = new Map(
    lists.map((el) => [el, el.firstElementChild!.cloneNode(false) as Element]),
  )
  let marked = [
    ...[...doc.querySelectorAll(`[${names.text}]`)].filter((el) =>
      !el.closest(LIST)
    ),
    ...lists,
  ]
  let isList = (el: Element) => like.has(el)
  let valueAt = (el: Element) => isList(el) ? listValue(el) : valueOf(el)
  let drawAt = (el: Element, value: string) =>
    isList(el) ? drawList(el, value, like.get(el)!) : draw(el, value)
  let placeAt = (el: Element) =>
    isList(el)
      ? placeOf(el.getAttribute(names.list)!, true)
      : placeOf(el.getAttribute(names.text)!)
  // The element typed in, or the list whose item it is.
  let unitOf = (el: Element) =>
    el.parentElement && isList(el.parentElement) ? el.parentElement : el
  let held = new Map<Element, Held>()
  for (let el of marked) {
    held.set(el, {
      // A list's items are typed in and moved where they stand, so its own
      // are kept apart.
      was: [...el.childNodes].map((n) => isList(el) ? n.cloneNode(true) : n),
      value: '',
    })
  }
  for (let [el, h] of held) h.value = valueAt(el)
  // Everything below goes by place: a snippet's `copy:<key>`, a list's
  // `copy-list:<key>`.
  let confirmed = (place: string) =>
    held.get(marked.find((el) => placeAt(el) == place)!)?.value ?? ''
  // A place can have several submitted values, in request order.
  let pending = new Map<string, string[]>()
  let own = (place: string) => pending.get(place)?.at(-1) ?? confirmed(place)
  let becomes = (place: string, value: string) => {
    for (let [el, h] of held) {
      if (placeAt(el) == place) Object.assign(h, { was: null, value })
    }
  }
  // A person's draft at a place; a list's that is no list is none.
  let draftAt = (place: string) => {
    let text = drafts.text(place)
    return text && parsePlace(place)?.list && !listOf(text) ? '' : text
  }
  let shows = (place: string) => draftAt(place) || own(place)
  // A draft is a change while it differs from the page's own words.
  let changed = (place: string) => {
    let text = draftAt(place)
    return !!text && text != own(place)
  }

  let sheet = style(doc)
  doc.documentElement.setAttribute(EDITING, '')
  let active: Element | null = null
  let locked: Element[] = []
  let ready = false
  let closed = false

  // An item's handle: beside the item pressed into or pointed at, and
  // dragged to move it among its list's items.
  let handle = doc.createElement('div')
  handle.setAttribute(HANDLE, '')
  handle.setAttribute('role', 'button')
  handle.setAttribute('aria-label', 'Drag to move this item')
  handle.hidden = true
  doc.documentElement.append(handle)
  let handled: Element | null = null
  let grip = (item: Element | null) => {
    handled = item
    handle.hidden = !item
    let box = item?.getBoundingClientRect?.()
    if (!item || !box) return
    let size = handle.offsetWidth || 24
    let x = Math.max(2, box.left - size - 6) + win.scrollX
    let y = box.top + box.height / 2 - (handle.offsetHeight || 28) / 2 +
      win.scrollY
    handle.style.left = `${x}px`
    handle.style.top = `${y}px`
  }
  let itemAt = (target: EventTarget | null) => {
    let el = target instanceof win.Element ? target : null
    for (; el; el = el.parentElement) {
      if (el.parentElement && isList(el.parentElement)) return el
    }
    return null
  }
  // A list's draft, typed from what it shows now; back to its own items, it
  // is no change.
  let typeList = (list: Element) => {
    let place = placeAt(list), value = listValue(list)
    if (value != own(place) || pending.has(place)) drafts.type(place, value)
    else if (drafts.text(place)) drafts.spend(place)
  }

  // The caret at the start or end of `el`, where the browser has one.
  let caret = (el: Element, end: boolean) => {
    let sel = win.getSelection?.()
    if (!sel || !doc.createRange) return
    let range = doc.createRange()
    range.selectNodeContents(el)
    range.collapse(!end)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  // Where the caret stands in an item's words, and where the selection ends:
  // at its end where the browser says nothing.
  let split = (item: Element) => {
    let text = item.textContent ?? ''
    let sel = win.getSelection?.()
    if (!sel?.rangeCount || !doc.createRange) return [text, '']
    let range = sel.getRangeAt(0)
    if (!item.contains(range.startContainer)) return [text, '']
    let upTo = (node: Node, offset: number) => {
      let r = doc.createRange()
      r.selectNodeContents(item)
      r.setEnd(node, offset)
      return r.toString().length
    }
    return [
      text.slice(0, upTo(range.startContainer, range.startOffset)),
      text.slice(upTo(range.endContainer, range.endOffset)),
    ]
  }
  // A new item after `item`, holding what followed the caret.
  let addAfter = (item: Element) => {
    let list = item.parentElement!
    let [before, after] = split(item)
    let next = like.get(list)!.cloneNode(false) as Element
    item.textContent = before
    next.textContent = after
    item.after(next)
    typeList(list)
    edit(next)
    caret(next, false)
  }
  // `item` gone, the caret at the end of the one before it.
  let removeItem = (item: Element) => {
    let list = item.parentElement!
    if (list.children.length < 2) return false
    let to = item.previousElementSibling ?? item.nextElementSibling!
    if (active == item) {
      active = null
      item.removeAttribute('contenteditable')
    }
    item.remove()
    typeList(list)
    edit(to)
    caret(to, true)
    return true
  }
  let move = (item: Element, by: -1 | 1) => {
    let to = by < 0 ? item.previousElementSibling : item.nextElementSibling
    if (!to) return
    if (by < 0) to.before(item)
    else to.after(item)
    typeList(item.parentElement!)
    ;(item as HTMLElement).focus?.()
    caret(item, true)
    grip(item)
  }

  let finish = () => {
    let el = active
    if (!el) return
    active = null
    el.removeAttribute('contenteditable')
    for (let child of locked) child.removeAttribute('contenteditable')
    locked = []
    let unit = unitOf(el)
    // An item left empty is no item.
    if (unit != el && !itemValue(el) && unit.children.length > 1) {
      if (handled == el) grip(null)
      el.remove()
      typeList(unit)
    }
    let place = placeAt(unit)
    // Typed back to the page's own words, it is no change, unless a save on
    // its way made them those words.
    if (
      drafts.text(place) && valueAt(unit) == own(place) && !pending.has(place)
    ) {
      drafts.spend(place)
    }
  }
  let edit = (el: Element) => {
    if (el == active || !ready) return
    finish()
    active = el
    for (let child of el.children) {
      if (child.hasAttribute(names.slot)) {
        child.setAttribute('contenteditable', 'false')
        locked.push(child)
      }
    }
    el.setAttribute('contenteditable', 'plaintext-only')
    ;(el as HTMLElement).focus?.()
    if (unitOf(el) != el) grip(el)
  }
  let ours = (e: Event) =>
    !(e.target instanceof win.Node) ||
    !doc.body?.contains(e.target as Node) &&
      !doc.head?.contains(e.target as Node)
  // The element a press lands in: an item, or the nearest snippet.
  let pressedIn = (target: Element) =>
    itemAt(target) ??
      (target.closest?.(`[${names.text}]`) as Element | null)
  let pressed = (e: Event) => {
    if (ours(e)) return
    e.stopImmediatePropagation()
    let el = pressedIn(e.target as Element)
    let ok = !!el && held.has(unitOf(el))
    // The caret goes where the press landed, and a touch still scrolls:
    // only going and pressing stop.
    if (!STOPS.includes(e.type)) {
      if (e.type == 'touchstart') return
      if (ok) edit(el!)
      else finish()
      return
    }
    if (ok) edit(el!)
    e.preventDefault()
  }
  let typed = (e: Event) => {
    if (ours(e) || !active) return
    if (!active.contains(e.target as Node)) return
    e.stopImmediatePropagation()
    let key = e as KeyboardEvent
    if (e.type == 'keydown' && key.key == 'Escape') return finish()
    let unit = unitOf(active)
    if (unit != active) {
      let item = active
      let kind = (e as InputEvent).inputType
      let down = e.type == 'keydown' && !key.isComposing
      // Enter adds an item, on a keyboard that says so or one that only
      // says what it would insert.
      if (
        down && key.key == 'Enter' && !key.shiftKey ||
        e.type == 'beforeinput' &&
          (kind == 'insertParagraph' || kind == 'insertLineBreak')
      ) {
        e.preventDefault()
        return addAfter(item)
      }
      if (
        (down && key.key == 'Backspace' ||
          e.type == 'beforeinput' && kind == 'deleteContentBackward') &&
        !item.textContent
      ) {
        if (removeItem(item)) e.preventDefault()
        return
      }
      if (down && key.altKey && /^Arrow(Up|Down)$/.test(key.key)) {
        e.preventDefault()
        return move(item, key.key == 'ArrowUp' ? -1 : 1)
      }
      if (e.type == 'input') {
        typeList(unit)
        grip(item)
      }
      return
    }
    // A snippet is a line unless it already holds more than one.
    if (
      e.type == 'keydown' && key.key == 'Enter' && !key.shiftKey &&
      !own(placeAt(active)).includes('\n')
    ) {
      e.preventDefault()
      return finish()
    }
    if (e.type == 'input') drafts.type(placeAt(active), valueOf(active))
  }
  let left = (e: Event) => {
    if (active && e.target == active) finish()
  }
  // Pointed at with a mouse, an item shows its handle.
  let over = (e: Event) => {
    if (ours(e) || moving) return
    let item = itemAt(e.target)
    if (item && item != handled) grip(item)
  }
  // An item dragged by its handle goes where it is dragged to: before or
  // after the item whose middle is nearest, as it came from above or below.
  let moving: Element | null = null
  let lift = (e: Event) => {
    let item = handled
    if (!item || !ready) return
    e.preventDefault()
    if (active && active != item) finish()
    moving = item
    item.setAttribute(MOVING, '')
    handle.setAttribute(MOVING, '')
    let id = (e as PointerEvent).pointerId
    if (id != null) handle.setPointerCapture?.(id)
  }
  let drag = (e: Event) => {
    let item = moving
    if (!item) return
    e.preventDefault()
    let { clientX: x, clientY: y } = e as PointerEvent
    let near = (el: Element) => {
      let b = el.getBoundingClientRect()
      return Math.hypot(b.left + b.width / 2 - x, b.top + b.height / 2 - y)
    }
    let others = [...item.parentElement!.children]
    let to = others.reduce((a, b) => near(b) < near(a) ? b : a)
    if (to == item) return
    let after = others.indexOf(to) > others.indexOf(item)
    if (after) to.after(item)
    else to.before(item)
    grip(item)
  }
  let drop = () => {
    let item = moving
    if (!item) return
    moving = null
    item.removeAttribute(MOVING)
    handle.removeAttribute(MOVING)
    if (item.parentElement) typeList(item.parentElement)
    grip(item)
  }
  for (let type of PRESSES) win.addEventListener(type, pressed, true)
  for (let type of KEYS) win.addEventListener(type, typed, true)
  doc.addEventListener('focusout', left, true)
  win.addEventListener('pointerover', over, true)
  handle.addEventListener('pointerdown', lift)
  handle.addEventListener('pointermove', drag)
  handle.addEventListener('pointerup', drop)
  handle.addEventListener('pointercancel', drop)
  handle.addEventListener('lostpointercapture', drop)
  let regrip = () => handled && grip(handled.isConnected ? handled : null)
  win.addEventListener('resize', regrip)

  let panel = opts.panel
  let button = (says: string, press: () => void) => {
    let b = doc.createElement('button')
    b.type = 'button'
    b.textContent = says
    b.addEventListener('click', press)
    return b
  }
  let done = button('Done', () => opts.done())
  let mine = () => drafts.places().filter((p) => parsePlace(p))
  let discard = button('Discard', () => {
    for (let place of mine()) {
      if (!pending.has(place)) drafts.spend(place)
    }
  })
  discard.dataset.discard = ''
  let count = doc.createElement('span')
  count.setAttribute('aria-live', 'polite')
  let said = doc.createElement('span')
  said.setAttribute('aria-live', 'polite')
  let send = opts.fetch ?? win.fetch.bind(win)
  let post = async (path: string, body: unknown) => {
    let to = new URL(`api/${path}`, new URL(opts.at, win.location.href))
    let sent = JSON.stringify(body)
    let res = await send(to, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: sent,
      // A save already shown goes on if the page is closed under it; the
      // browser carries no more than 64 KB that way.
      keepalive: sent.length < 60_000,
    })
    let out = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(out?.error?.message ?? `it answered ${res.status}`)
    }
    return out
  }
  // The last save, for Undo: its version, what it sent, and the words each
  // place had before it.
  let last: {
    version: number
    sent: Record<string, string>
    before: Record<string, string>
  } | null = null
  let perf = win.performance
  let timed = (ms: number, server: number) => {
    if (!opts.report) return
    let body = JSON.stringify({
      id: win.crypto.randomUUID(),
      at: Math.floor(perf.timeOrigin + perf.now()),
      points: [savePoint(ms, server)],
    })
    if (!opts.fetch && win.navigator.sendBeacon?.(opts.report, body)) return
    void send(opts.report, { method: 'POST', body, keepalive: true })
      .catch(() => {/* a time can be lost with the page */})
  }
  // Saves and Undo go one after another, each after the one before answered.
  let turn = Promise.resolve()
  let saves = 0
  let save = button('Save', () => {
    let began = perf.now()
    finish()
    let sent: Record<string, string> = {}
    for (let place of mine()) {
      if (changed(place)) sent[place] = draftAt(place)
    }
    let places = Object.keys(sent)
    if (!places.length) return
    for (let place of places) {
      let values = pending.get(place)
      if (!values) pending.set(place, values = [])
      values.push(sent[place])
    }
    // What the app's door is sent: each key's text, or a list's items.
    let copy = Object.fromEntries(places.map((place) => {
      let { key, list } = parsePlace(place)!
      return [key, list ? listOf(sent[place]) : sent[place]]
    }))
    let n = ++saves
    said.textContent = SAVED
    undo.hidden = true
    redraw()
    turn = turn.then(async () => {
      let before = Object.fromEntries(
        places.map((place) => [place, confirmed(place)]),
      )
      let asked = perf.now()
      try {
        let { version, keys: made } = await post('save', { copy })
        for (let place of places) {
          becomes(place, sent[place])
          // Spend only the last submission for this place and only its text.
          if (
            pending.get(place)?.length == 1 &&
            drafts.text(place) == sent[place]
          ) drafts.spend(place)
        }
        if (n != saves) return
        let saved = places.filter((place) =>
          made.includes(parsePlace(place)!.key)
        )
        last = saved.length
          ? {
            version,
            sent: Object.fromEntries(
              saved.map((place) => [place, sent[place]]),
            ),
            before,
          }
          : null
        said.textContent = savedAs(version)
        undo.hidden = !last
      } catch (e) {
        if (n == saves) last = null
        said.textContent = `Not saved: ${(e as Error).message}. ` +
          'Your changes are kept.'
        if (closed && !panel.childNodes.length) panel.append(said)
      } finally {
        for (let place of places) {
          let values = pending.get(place)!
          values.shift()
          if (!values.length) pending.delete(place)
        }
        if (closed) restorePage()
        else redraw()
        let now = perf.now()
        timed(now - began, now - asked)
      }
    })
  })
  save.dataset.save = ''
  let undo = button('Undo', () => {
    let was = last
    if (!was) return
    last = null
    undo.disabled = true
    turn = turn.then(async () => {
      try {
        await post('save/undo', { version: was.version })
        for (let [place, text] of Object.entries(was.sent)) {
          becomes(place, was.before[place])
          if (!drafts.text(place)) drafts.type(place, text)
        }
        undo.hidden = true
        said.textContent = `Version ${was.version} is taken back. ` +
          'Your changes are drafts again.'
      } catch (e) {
        last = was
        said.textContent = `Not taken back: ${(e as Error).message}`
        if (closed && !panel.childNodes.length) panel.append(said)
      } finally {
        undo.disabled = false
        if (closed) restorePage()
        else redraw()
      }
    })
  })
  undo.dataset.undo = ''
  undo.hidden = true
  if (!marked.length) {
    let says = doc.createElement('p')
    says.textContent = 'Nothing on this page is editable yet.'
    let link = doc.createElement('a')
    let to = new URL(opts.ask)
    to.searchParams.set('say', asking(win.location.href))
    link.href = to.href
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = 'Ask the Operator to make it editable'
    panel.replaceChildren(says, link, done)
  } else {
    count.textContent = 'Loading your changes…'
    panel.replaceChildren(count, save, discard, said, undo, done)
  }

  // Every element shows its key's draft, or the page's words where it has
  // none, drawn again as a draft changes here or on another device. The one
  // being typed in is left alone while it already shows its draft.
  let redraw = () => {
    if (!ready || closed) return
    let changes = mine().filter(changed).length
    count.textContent = changes ? counted(changes) : hint(win)
    save.hidden = discard.hidden = !changes
    for (let el of marked) {
      let place = placeAt(el), value = shows(place)
      el.toggleAttribute(CHANGED, changed(place))
      if (valueAt(el) != value) drawAt(el, value)
    }
    regrip()
  }
  let restorePage = () => {
    if (doc.documentElement.hasAttribute(EDITING)) return
    for (let [el, h] of held) {
      el.removeAttribute(CHANGED)
      let place = placeAt(el), value = own(place)
      if (h.was && !pending.has(place)) el.replaceChildren(...h.was)
      else if (valueAt(el) != value) drawAt(el, value)
    }
  }
  let stop = () => {}
  drafts.ready.then(() => {
    if (closed) return
    ready = true
    stop = drafts.follow(redraw)
  }, () => {
    count.textContent = 'Your changes could not be read. Try again.'
  })

  return {
    stop: () => {
      closed = true
      finish()
      stop()
      for (let type of PRESSES) win.removeEventListener(type, pressed, true)
      for (let type of KEYS) win.removeEventListener(type, typed, true)
      doc.removeEventListener('focusout', left, true)
      win.removeEventListener('pointerover', over, true)
      win.removeEventListener('resize', regrip)
      handle.remove()
      doc.documentElement.removeAttribute(EDITING)
      restorePage()
      sheet()
      panel.replaceChildren()
      return turn
    },
  }
}

// The outlines, as a sheet of the page's own: a constructed one where the
// browser has them, which a page's style-src does not govern. Answers the
// function that takes it off again.
let style = (doc: Document) => {
  let win = doc.defaultView as (Window & typeof globalThis) | null
  if (win?.CSSStyleSheet && 'adoptedStyleSheets' in doc) {
    let sheet = new win.CSSStyleSheet()
    sheet.replaceSync(CSS)
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    return () => {
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s != sheet)
    }
  }
  let el = doc.createElement('style')
  el.textContent = CSS
  doc.head.append(el)
  return () => el.remove()
}
