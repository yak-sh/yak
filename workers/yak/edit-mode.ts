// Edit mode on an app's page: the words a member may type over where they
// stand. public/edit.js draws the pencil and loads this, served at the app's
// `./api/_edit.js` (client-assets.ts), once it is pressed; a stranger, a guest
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
// The panel beside the pencil counts the person's changes to this app and
// discards them, which empties each draft (the journal keeps what it held).
// A page with nothing marked says so, and offers the Operator's chat with the
// ask to mark this page already typed.
import { fill, join, names } from '@yaks/copy'

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
  /** The Operator's chat for this app (`/manage/<space>?app=<slug>`). */
  ask: string
  /** Edit mode is over: the person pressed Done. */
  done: () => void
}

/** The place a snippet's draft is typed at. */
export let placeOf = (key: string) => `copy:${key}`
let PLACE = placeOf('')

/** What a person says the Operator, from a page with nothing marked. */
export let asking = (page: string) =>
  `Move the words on ${page} into copy.json, marking each element with ` +
  'data-copy, so I can change them on the page.'

/** How many changes a count is, as the panel says it. */
export let counted = (n: number) => n == 1 ? '1 change' : `${n} changes`

let EDITING = 'data-yak-editing'
let CHANGED = 'data-yak-changed'
let CSS = `
[${EDITING}] [${names.text}] {
  outline: 1.5px dashed rgb(76 119 62 / 0.75) !important;
  outline-offset: 2px !important;
  cursor: text !important;
}
[${EDITING}] [${names.text}][${CHANGED}] {
  outline-color: rgb(201 122 26 / 0.9) !important;
}
[${EDITING}] [${names.text}]:hover,
[${EDITING}] [${names.text}][contenteditable=plaintext-only],
[${EDITING}] [${names.text}][contenteditable=true] {
  outline-style: solid !important;
}
[${EDITING}] [${names.text}] [${names.slot}] {
  cursor: default !important;
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

type Held = { was: Node[]; value: string }

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
  let marked = [...doc.querySelectorAll(`[${names.text}]`)]
  let held = new Map<Element, Held>()
  for (let el of marked) held.set(el, { was: [...el.childNodes], value: '' })
  for (let [el, h] of held) h.value = valueOf(el)
  let keyOf = (el: Element) => el.getAttribute(names.text)!
  // The page's own words for a key: the first element showing it.
  let own = (key: string) =>
    held.get(marked.find((el) => keyOf(el) == key)!)?.value ?? ''
  let shows = (key: string) => drafts.text(placeOf(key)) || own(key)

  let sheet = style(doc)
  doc.documentElement.setAttribute(EDITING, '')
  let active: Element | null = null
  let locked: Element[] = []
  let ready = false
  let closed = false

  let finish = () => {
    let el = active
    if (!el) return
    active = null
    el.removeAttribute('contenteditable')
    for (let child of locked) child.removeAttribute('contenteditable')
    locked = []
    let place = placeOf(keyOf(el))
    // Typed back to the page's own words, it is no change.
    if (drafts.text(place) && valueOf(el) == own(keyOf(el))) {
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
  }
  let ours = (e: Event) =>
    !(e.target instanceof win.Node) ||
    !doc.body?.contains(e.target as Node) &&
      !doc.head?.contains(e.target as Node)
  let pressed = (e: Event) => {
    if (ours(e)) return
    e.stopImmediatePropagation()
    let el = (e.target as Element).closest?.(`[${names.text}]`)
    // The caret goes where the press landed, and a touch still scrolls:
    // only going and pressing stop.
    if (!STOPS.includes(e.type)) {
      if (e.type == 'touchstart') return
      if (el && held.has(el)) edit(el)
      else finish()
      return
    }
    if (el && held.has(el)) edit(el)
    e.preventDefault()
  }
  let typed = (e: Event) => {
    if (ours(e) || !active) return
    if (!active.contains(e.target as Node)) return
    e.stopImmediatePropagation()
    let key = e as KeyboardEvent
    if (e.type == 'keydown' && key.key == 'Escape') return finish()
    // A snippet is a line unless it already holds more than one.
    if (
      e.type == 'keydown' && key.key == 'Enter' && !key.shiftKey &&
      !own(keyOf(active)).includes('\n')
    ) {
      e.preventDefault()
      return finish()
    }
    if (e.type == 'input') drafts.type(placeOf(keyOf(active)), valueOf(active))
  }
  let left = (e: Event) => {
    if (active && e.target == active) finish()
  }
  for (let type of PRESSES) win.addEventListener(type, pressed, true)
  for (let type of KEYS) win.addEventListener(type, typed, true)
  doc.addEventListener('focusout', left, true)

  let panel = opts.panel
  let button = (says: string, press: () => void) => {
    let b = doc.createElement('button')
    b.type = 'button'
    b.textContent = says
    b.addEventListener('click', press)
    return b
  }
  let done = button('Done', () => opts.done())
  let discard = button('Discard', () => {
    for (let place of drafts.places()) {
      if (place.startsWith(PLACE)) drafts.spend(place)
    }
  })
  discard.dataset.discard = ''
  let count = doc.createElement('span')
  count.setAttribute('aria-live', 'polite')
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
    panel.replaceChildren(count, discard, done)
  }

  // Every element shows its key's draft, or the page's words where it has
  // none, drawn again as a draft changes here or on another device. The one
  // being typed in is left alone while it already shows its draft.
  let stop = () => {}
  drafts.ready.then(() => {
    if (closed) return
    ready = true
    stop = drafts.follow(() => {
      let changes = drafts.places().filter((p) => p.startsWith(PLACE)).length
      count.textContent = changes
        ? counted(changes)
        : 'Press any outlined words to change them'
      discard.hidden = !changes
      for (let el of marked) {
        let key = keyOf(el), value = shows(key)
        el.toggleAttribute(CHANGED, !!drafts.text(placeOf(key)))
        if (valueOf(el) != value) draw(el, value)
      }
    })
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
      // The page goes back to its own words; the drafts stay drafts.
      for (let [el, h] of held) {
        el.removeAttribute(CHANGED)
        el.replaceChildren(...h.was)
      }
      doc.documentElement.removeAttribute(EDITING)
      sheet()
      panel.replaceChildren()
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
