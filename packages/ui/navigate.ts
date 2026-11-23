/**
 * Moving between a site's server-drawn pages without loading a new document.
 * A link to a page of the same origin is fetched, and the page it answers is
 * laid over the one on screen (`morph`): a node that stands in both pages
 * keeps its place, its listeners and its loaded image, and only what differs
 * is changed. The sidebar and the header of a shell stay as they were, and an
 * image beside a link never loads again.
 *
 * A page takes part by loading the navigator in a script marked
 * `data-navigate` (`TAKES`, `start`); a link to a page that
 * does not load it, a failed fetch or an answer that is not HTML is followed
 * as the browser would follow it.
 *
 * What scripts do across a swap:
 *
 * - A script with a `src` runs once in the document's life, the first time a
 *   page names it. One that binds elements as it loads binds what each swap
 *   brings on `yak-page` too, once an element (`arrived`).
 * - A script written into the page is the page's own: it runs after every
 *   swap that lands on its page. Before each swap the document hears
 *   `yak-leave`, and such a script takes back there what it set going (a
 *   listener on the window, a timer), most simply by adding its listeners
 *   with a signal it aborts then (`leaving`).
 * - A script marked `data-stays` holds its page (a socket, a mounted app)
 *   and cannot be taken back: a page holding one is left by loading the next.
 *
 * @module
 */

import type { HistoryPort } from './history.ts'

/** What a swap did to the nodes on screen: those kept in place, those made
 * from the new page, those taken away. */
export type Tally = { kept: number; made: number; dropped: number }

/** The mark on the script that loads the navigator: a page wearing it
 * takes part. */
export let TAKES = 'data-navigate'
/** Heard on the document before a swap, by the page it takes away. */
export let LEAVE = 'yak-leave'
/** Heard on the document after a swap, by the page it brought. */
export let PAGE = 'yak-page'

let ELEMENT = 1
let TEXT = 3
let COMMENT = 8

let el = (n: Node): Element | null =>
  n.nodeType == ELEMENT ? n as Element : null

// What makes a node the same node in both pages, where something does: its
// id, its `data-key`, the address an image, script, link or anchor names. An
// inline script has none, so it is always the new page's (it runs again).
let keyOf = (n: Node): string | null => {
  let e = el(n)
  if (!e) return null
  let tag = e.localName
  if (e.id) return `${tag}#${e.id}`
  let key = e.getAttribute('data-key')
  if (key != null) return `${tag}[${key}]`
  let at = tag == 'img' || tag == 'script'
    ? e.getAttribute('src')
    : tag == 'a' || tag == 'link'
    ? e.getAttribute('href')
    : null
  return at ? `${tag} ${e.getAttribute('rel') ?? ''} ${at}` : null
}

let alike = (a: Node, b: Node) =>
  a.nodeType == b.nodeType &&
  (a.nodeType != ELEMENT ||
    (a as Element).localName == (b as Element).localName)

let size = (n: Node): number => {
  let count = 1
  for (let c of n.childNodes) count += size(c)
  return count
}

// A form control whose value the page sends: set as the property too, since
// the attribute alone no longer moves what a control shows once it is drawn.
let control = (a: Element, b: Element) => {
  let input = a as HTMLInputElement
  if (a.localName == 'input') {
    let value = b.getAttribute('value')
    if (value != a.getAttribute('value')) input.value = value ?? ''
    let checked = b.hasAttribute('checked')
    if (checked != a.hasAttribute('checked')) input.checked = checked
  }
  if (a.localName == 'textarea' && a.textContent != b.textContent) {
    ;(a as HTMLTextAreaElement).value = b.textContent ?? ''
  }
}

let attributes = (a: Element, b: Element) => {
  control(a, b)
  for (let { name } of [...a.attributes]) {
    if (!b.hasAttribute(name)) a.removeAttribute(name)
  }
  for (let { name, value } of [...b.attributes]) {
    if (a.getAttribute(name) != value) a.setAttribute(name, value)
  }
}

/** Options for `morph`: `leave` names a node of the old page that stays where
 * the new page has nothing for it (a stylesheet a script put in the head). */
export type Morphing = { leave?: (n: Node) => boolean }

/** Make `was` the same as `next` in place, keeping every node of `was` that
 * stands in `next` (by `keyOf`, else by its kind at its place), and answer
 * what was kept, made and dropped. Nodes are made in `was`'s document. */
/// import { parseHTML } from 'linkedom'
/// let { document } = parseHTML('<ul><li id="a">A</li><li>B</li></ul>')
/// let next = parseHTML('<ul><li id="a">A</li><li>C</li></ul>').document
/// let a = document.getElementById('a')
/// morph(document.querySelector('ul'), next.querySelector('ul'))
/// document.querySelector('ul').outerHTML -> '<ul><li id="a">A</li><li>C</li></ul>'
/// document.getElementById('a') == a -> true
export let morph = (
  was: Node,
  next: Node,
  o: Morphing = {},
  tally: Tally = { kept: 0, made: 0, dropped: 0 },
): Tally => {
  if (was.nodeType == TEXT || was.nodeType == COMMENT) {
    if (was.nodeValue != next.nodeValue) was.nodeValue = next.nodeValue
    tally.kept++
    return tally
  }
  let a = el(was), b = el(next)
  if (a && b) {
    if (a.isEqualNode(b)) {
      tally.kept += size(a)
      return tally
    }
    attributes(a, b)
    if (a.localName == 'script') {
      tally.kept++
      return tally
    }
    if (a.localName == 'template') {
      if (a.innerHTML != b.innerHTML) a.innerHTML = b.innerHTML
      tally.kept++
      return tally
    }
  }
  tally.kept++
  children(was, next, o, tally)
  return tally
}

let children = (was: Node, next: Node, o: Morphing, tally: Tally) => {
  let doc = was.ownerDocument ?? was as Document
  let old = [...was.childNodes]
  let keyed = new Map<string, Node>()
  for (let n of old) {
    let key = keyOf(n)
    if (key && !keyed.has(key)) keyed.set(key, n)
  }
  let used = new Set<Node>()
  let at = 0
  let pairs: [Node, Node][] = []
  let wanted = [...next.childNodes].map((n) => {
    let key = keyOf(n)
    let match: Node | undefined
    if (key) {
      match = keyed.get(key)
      if (match && (used.has(match) || !alike(match, n))) match = undefined
    } else {
      while (at < old.length && (used.has(old[at]) || keyOf(old[at]))) at++
      if (at < old.length && alike(old[at], n)) match = old[at++]
    }
    if (!match) {
      let made = doc.importNode(n, true)
      tally.made += size(made)
      return made
    }
    used.add(match)
    pairs.push([match, n])
    return match
  })
  let ref = was.firstChild
  for (let n of wanted) {
    while (ref && !used.has(ref)) ref = ref.nextSibling
    if (n == ref) ref = ref.nextSibling
    else was.insertBefore(n, ref)
  }
  for (let n of old) {
    if (used.has(n) || o.leave?.(n)) continue
    tally.dropped += size(n)
    n.parentNode?.removeChild(n)
  }
  for (let [a, b] of pairs) morph(a, b, o, tally)
}

// What a head keeps of the page before: what a script or the browser put
// there and a later page has no word on.
let leaveInHead = (n: Node) => {
  let e = el(n)
  if (!e) return false
  let rel = e.getAttribute('rel') ?? ''
  return e.localName == 'script' || e.localName == 'style' ||
    (e.localName == 'link' && /stylesheet|preload|modulepreload/.test(rel))
}

let RUNS = /^(|module|text\/javascript|application\/javascript)$/

/** The scripts of a document that run, as nodes. */
let scripts = (doc: Document): HTMLScriptElement[] =>
  [...doc.querySelectorAll('script')].filter((s) =>
    RUNS.test(s.getAttribute('type') ?? '')
  )

/** Where a script's `src` leads, whole, or null for one written in. */
let source = (s: Element, base: string): string | null => {
  let src = s.getAttribute('src')
  return src ? new URL(src, base).href : null
}

/** A script that runs: a new element in place of one the parser wrote,
 * which a document never runs once it was parsed elsewhere. */
export let rerun = (s: Element): void => {
  let doc = s.ownerDocument
  let fresh = doc.createElement('script')
  for (let { name, value } of [...s.attributes]) fresh.setAttribute(name, value)
  fresh.textContent = s.textContent
  if (fresh.hasAttribute('src')) (fresh as HTMLScriptElement).async = false
  s.replaceWith(fresh)
}

/** A page's scripts that hold it (`data-stays`): one standing means the
 * page is left by loading the next. */
export let stays = (doc: Document): boolean =>
  !!doc.querySelector('script[data-stays]')

/**
 * Lay the page `next` over `doc`: its head and its body changed in place
 * (`morph`), the scripts it names for the first time run, and every script
 * written into it run again. `ran` holds the addresses of the scripts that
 * have run in `doc`, and gains those run now; `run` runs one; `base` is the
 * address relative ones are read against.
 */
export let swap = (
  doc: Document,
  next: Document,
  ran: Set<string>,
  run: (s: Element) => void = rerun,
  base: string = doc.baseURI,
): Tally => {
  let before = new Set(scripts(doc))
  attributes(doc.documentElement, next.documentElement)
  let tally = morph(doc.head, next.head, { leave: leaveInHead })
  morph(doc.body, next.body, {}, tally)
  for (let s of scripts(doc)) {
    if (before.has(s)) continue
    let src = source(s, base)
    if (src && ran.has(src)) continue
    if (src) ran.add(src)
    run(s)
  }
  return tally
}

/** The scripts with a `src` a document has run, read against `base`. */
export let sources = (
  doc: Document,
  base: string = doc.baseURI,
): Set<string> =>
  new Set(
    scripts(doc).map((s) => source(s, base)).filter((s) => s != null),
  )

/** Run `bind` over the document now and over every page a swap brings,
 * each element once: `of` selects them. For a script with a `src`, which
 * runs once. */
export let arrived = <E extends Element>(
  of: string,
  bind: (e: E) => void,
  doc: Document = document,
): void => {
  let bound = new WeakSet<Element>()
  let each = () => {
    for (let e of doc.querySelectorAll<E>(of)) {
      if (bound.has(e)) continue
      bound.add(e)
      bind(e)
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

/** A signal aborted when the page leaves (`yak-leave`), for a script written
 * into a page to add its listeners with. */
export let leaving = (doc: Document = document): AbortSignal => {
  let leave = new AbortController()
  doc.addEventListener(LEAVE, () => leave.abort(), { once: true })
  return leave.signal
}

/** What `start` needs of the window around it. */
export type Browsing =
  & Pick<
    Window,
    'document' | 'location' | 'addEventListener' | 'fetch' | 'scrollTo'
  >
  & { DOMParser: typeof DOMParser }

/** What a swap said once done: how long the click took to the new page, in
 * milliseconds, and what changed. The detail of `yak-page`. */
export type Swapped = { ms: number; tally: Tally; url: string }

// Where a page's content is: what its skip link names, else its `main`.
let content = (doc: Document) => {
  let to = doc.querySelector('a.Skip[href^="#"]')?.getAttribute('href')
  return (to && to.length > 1 ? doc.getElementById(to.slice(1)) : null) ??
    doc.querySelector('main')
}

let page = (url: URL | Location) => url.pathname + url.search

// An event told to the whole document, made by its own window.
let tell = (doc: Document, type: string, detail?: unknown) => {
  let view = (doc.defaultView ?? globalThis) as typeof globalThis
  doc.dispatchEvent(new view.CustomEvent(type, { bubbles: true, detail }))
}

/**
 * Follow the links of `win`'s pages in place: a click on a link to another
 * page of the same origin, and Back and Forward between such pages, fetch it
 * and `swap` it in. The new page's content (`content`) starts at its top and
 * takes the focus, as a new document would. Answers `go`, which visits an
 * address the same way.
 */
export let start = (
  win: Browsing,
  history: HistoryPort,
  now: () => number = () => performance.now(),
): (to: URL, pop?: boolean) => Promise<void> => {
  let doc = win.document
  let ran = sources(doc, win.location.href)
  let here = page(win.location)
  let pending: AbortController | undefined
  // Back and Forward have already moved the address: the page loads there.
  let load = (to: URL, pop = false) =>
    pop ? win.location.replace(to.href) : win.location.assign(to.href)
  let go = async (to: URL, pop = false) => {
    if (stays(doc)) return load(to, pop)
    pending?.abort()
    let mine = pending = new AbortController()
    let began = now()
    let answer = await win.fetch(to.href, {
      headers: { accept: 'text/html' },
      credentials: 'same-origin',
      signal: mine.signal,
    }).catch(() => null)
    if (mine != pending) return
    let type = answer?.headers.get('content-type') ?? ''
    if (!answer || !type.includes('text/html')) return load(to, pop)
    let text = await answer.text().catch(() => null)
    if (mine != pending) return
    if (text == null) return load(to, pop)
    let next = new win.DOMParser().parseFromString(text, 'text/html')
    if (!next.querySelector(`script[${TAKES}]`)) return load(to, pop)
    let at = new URL(answer.url || to.href)
    at.hash = to.hash
    tell(doc, LEAVE)
    let tally = swap(doc, next, ran, rerun, at.href)
    if (!pop) {
      history.write({ path: at.pathname + at.search + at.hash, state: null })
    }
    here = page(at)
    if (!pop) {
      let target = at.hash &&
        doc.getElementById(decodeURIComponent(at.hash.slice(1)))
      let main = content(doc) as HTMLElement | null
      if (target) target.scrollIntoView()
      else {
        win.scrollTo(0, 0)
        if (main) main.scrollTop = 0
      }
      main?.focus?.({ preventScroll: true })
    }
    pending = undefined
    let detail: Swapped = { ms: now() - began, tally, url: at.href }
    tell(doc, PAGE, detail)
  }
  win.addEventListener('click', (e: MouseEvent) => {
    let link = (e.target as Element | null)?.closest?.('a[href]') as
      | HTMLAnchorElement
      | null
    if (
      !link || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey ||
      e.shiftKey || e.altKey || link.hasAttribute('download') ||
      (link.target && link.target != '_self')
    ) return
    let to = new URL(link.getAttribute('href')!, win.location.href)
    if (to.origin != win.location.origin) return
    if (page(to) == here && to.hash) return
    e.preventDefault()
    go(to)
  })
  history.listen(({ path }) => {
    let to = new URL(path, win.location.href)
    if (page(to) == here) return
    go(to, true)
  })
  return go
}
