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
// Save sends them to the app's `api/save` (save.ts), which sets them in its
// copy.json and releases it; once it answers, the page's own words are the
// saved ones and the drafts are spent. A save refused or failed leaves every
// draft as it was. The panel then says which version was saved and offers
// Undo (`api/save/undo`), which takes that release back and makes the
// changes drafts again, as they were before Save.
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
  /** The app's address, whose `api/save` Save sends to (`/cookbook/`). */
  at: string
  /** How Save reaches it; the page's own fetch where left out. */
  fetch?: typeof fetch
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

/** What the panel says once Save has answered. */
export let savedAs = (version: number) => `Saved as version ${version}`

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
  // A key's own words are now `value`: what Save released, or Undo put back.
  let becomes = (key: string, value: string) => {
    for (let [el, h] of held) {
      if (keyOf(el) == key) Object.assign(h, { was: null, value })
    }
  }
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
  let mine = () => drafts.places().filter((p) => p.startsWith(PLACE))
  let discard = button('Discard', () => {
    for (let place of mine()) drafts.spend(place)
  })
  discard.dataset.discard = ''
  let count = doc.createElement('span')
  count.setAttribute('aria-live', 'polite')
  let said = doc.createElement('span')
  said.setAttribute('aria-live', 'polite')
  let post = async (path: string, body: unknown) => {
    let to = new URL(`api/${path}`, new URL(opts.at, win.location.href))
    let res = await (opts.fetch ?? win.fetch.bind(win))(to, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    let out = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(out?.error?.message ?? `it answered ${res.status}`)
    }
    return out
  }
  // The last save, for Undo: its version, what it sent, and the words each
  // key had before it.
  let last: {
    version: number
    sent: Record<string, string>
    before: Record<string, string>
  } | null = null
  let busy = false
  let save = button('Save', async () => {
    if (busy) return
    finish()
    let sent: Record<string, string> = {}
    for (let place of mine()) {
      let text = drafts.text(place)
      if (text) sent[place.slice(PLACE.length)] = text
    }
    if (!Object.keys(sent).length) return
    busy = save.disabled = true
    said.textContent = 'Saving…'
    undo.hidden = true
    try {
      let { version, keys } = await post('save', { copy: sent })
      let before: Record<string, string> = {}
      for (let [key, text] of Object.entries(sent)) {
        before[key] = own(key)
        becomes(key, text)
        // A draft typed on since it was sent is still a change.
        if (drafts.text(placeOf(key)) == text) drafts.spend(placeOf(key))
      }
      last = keys.length ? { version, sent, before } : null
      said.textContent = savedAs(version)
      undo.hidden = !last
    } catch (e) {
      said.textContent = `Not saved: ${(e as Error).message}. ` +
        'Your changes are kept.'
    } finally {
      busy = save.disabled = false
    }
  })
  save.dataset.save = ''
  let undo = button('Undo', async () => {
    let was = last
    if (busy || !was) return
    busy = undo.disabled = true
    try {
      await post('save/undo', { version: was.version })
      for (let [key, text] of Object.entries(was.sent)) {
        becomes(key, was.before[key])
        drafts.type(placeOf(key), text)
      }
      last = null
      undo.hidden = true
      said.textContent = `Version ${was.version} is taken back. ` +
        'Your changes are drafts again.'
    } catch (e) {
      said.textContent = `Not taken back: ${(e as Error).message}`
    } finally {
      busy = undo.disabled = false
    }
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
  let stop = () => {}
  drafts.ready.then(() => {
    if (closed) return
    ready = true
    stop = drafts.follow(() => {
      let changes = mine().length
      count.textContent = changes
        ? counted(changes)
        : 'Press any outlined words to change them'
      save.hidden = discard.hidden = !changes
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
        if (h.was) el.replaceChildren(...h.was)
        else draw(el, h.value)
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
