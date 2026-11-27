/**
 * A page's part in being kept (./worker.ts): it registers its site's worker
 * once it has loaded. It sends a snapshot when the loaded page is first
 * controlled, again once it has stood unchanged for a moment (`QUIET`), and
 * when it is left (hidden or unloaded, once for both) or left in place
 * (`yak-leave`), if it changed since. A part that moves by itself (`MOVES`)
 * or that nobody sees, an inert one of two that take turns (`TURNS`) among
 * them, changes nothing. A page with parts of its own (`OWN`) sends its shell beside it:
 * the same document with those parts empty. The fresh page that replaces
 * a picture sends its own snapshot.
 *
 * @module
 */
import { KEPT, LIVE, MOVES, OWN, SCROLL, TURNS } from './picture.ts'
import { LEAVE, PAGE } from '@yaks/ui/navigate'
import type { Snapshot } from './worker.ts'
import { absolute } from './picture-sheets.ts'

/** What `keep` needs of the window around the page. */
export type Window = {
  document:
    & Pick<
      Document,
      | 'documentElement'
      | 'visibilityState'
      | 'readyState'
      | 'getElementById'
      | 'createElement'
    >
    & {
      scrollingElement?: Element | null
      addEventListener(type: string, hear: () => void): void
    }
  location: { href: string }
  navigator: {
    serviceWorker?: Pick<
      ServiceWorkerContainer,
      'register' | 'controller' | 'addEventListener'
    >
  }
  performance: { timeOrigin: number }
  innerHeight: number
  setTimeout(run: () => void, ms: number): number
  clearTimeout(id?: number): void
  requestIdleCallback?(run: () => void, o: { timeout: number }): number
  getComputedStyle(e: Element): CSSStyleDeclaration
  MutationObserver: typeof MutationObserver
  addEventListener(
    type: string,
    hear: () => void,
    options?: AddEventListenerOptions,
  ): void
  reportError?: (error: unknown) => void
}

// What a page holds that nobody sees: a picture of it would only be slower
// to draw, and its scripts never run in one (./picture.ts).
let UNSEEN = `script, template, [hidden], dialog:not([open]), [${TURNS}][inert]`

// What a change to the page is: anything but what happens in a part nobody
// sees or one that moves by itself, unless it shows or hides that part.
let SHOWING = new Set(['hidden', 'inert', 'open'])
let STILL = `${UNSEEN}, [${MOVES}]`
let changing = (r: MutationRecord) => {
  if (r.type == 'attributes' && SHOWING.has(r.attributeName!)) return true
  let at = r.target.nodeType == 1 ? r.target as Element : r.target.parentElement
  return !at?.closest(STILL)
}

let scroll = (pane: Element) =>
  pane.scrollTop > 0 &&
    pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 2
    ? 'end'
    : String(Math.max(0, pane.scrollTop || 0))

// What lies far above or below what the window or a scrolled pane shows is
// left out too: a picture lays out all it holds before it paints, and a long
// conversation is many screens of it. Each keeps one of its own heights
// either side of what it shows, for the first moment of a scroll.
type Reach = { top: number; bottom: number; shift: number }
let reach = (top: number, height: number): Reach => ({
  top: top - height,
  bottom: top + 2 * height,
  shift: 0,
})

// A parent whose children stand one under the next, so taking one out moves
// only what follows it: a block, a flex column, or a grid of one column its
// children flow down. And a child that stands that way in it.
let stacked = (s: CSSStyleDeclaration) =>
  /^(block|inline-block|flow-root|list-item)$/.test(s.display) ||
  /flex$/.test(s.display) && s.flexDirection.startsWith('column') &&
    s.flexWrap == 'nowrap' ||
  /grid$/.test(s.display) && s.gridAutoFlow.startsWith('row') &&
    s.gridTemplateColumns.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/)
        .length == 1
let BLOCK = /^(block|flex|grid|table|list-item|flow-root)$/
let placed = (s: CSSStyleDeclaration) =>
  s.gridRowStart != 'auto' || s.gridColumnStart != 'auto'

// Leaves out what lies beyond `within`. A child that is out of the flow
// goes freely. One in it goes only from a stacked
// parent, and the height gone above what shows is the pane's `shift`, which
// its scroll position gives back. The address's `target` always stays. Only
// what holds a pane (`holds`) or reaches past `within` is looked into.
type Trim = {
  win: Window
  target: Element | null
  holds: Set<Element>
  omitted: Set<Element>
  positions: Map<Element, string>
}
let beyond = (
  t: Trim,
  live: Element,
  style: CSSStyleDeclaration,
  within: Reach,
) => {
  let flow = stacked(style)
  let removed = Infinity, kept = Infinity
  for (let e of live.children) {
    if (e.namespaceURI != HTML) continue
    let s = t.win.getComputedStyle(e)
    if (s.display == 'none') continue
    if (s.display == 'contents') {
      beyond(t, e, style, within)
      continue
    }
    let r = e.getBoundingClientRect()
    let loose = s.position == 'absolute' || s.position == 'fixed'
    let flowing = !loose && flow && BLOCK.test(s.display) &&
      s.float == 'none' && s.position != 'sticky' && !placed(s)
    let above = r.bottom < within.top
    let out = (above || r.top > within.bottom) && !e.contains(t.target)
    if (out && (loose || flowing)) {
      t.omitted.add(e)
      if (flowing && above) removed = Math.min(removed, r.top)
      continue
    }
    if (!loose) kept = Math.min(kept, r.top)
    // What stays above keeps its height, or what shows would move.
    if (above) continue
    let pane = e.hasAttribute(SCROLL)
    if (
      !pane && !t.holds.has(e) && r.top >= within.top &&
      r.bottom <= within.bottom
    ) {
      continue
    }
    let inner = pane
      ? reach(r.top, Math.min(r.height, t.win.innerHeight))
      : within
    beyond(t, e, s, inner)
    if (pane) unshift(t.positions, e, inner)
  }
  if (removed < kept && kept < Infinity) within.shift += kept - removed
}
let HTML = 'http://www.w3.org/1999/xhtml'

// A pane scrolled to a place is scrolled less by what went above it.
let unshift = (positions: Map<Element, string>, e: Element, pane: Reach) => {
  let at = positions.get(e)
  if (at && at != 'end' && pane.shift) {
    positions.set(e, String(Math.max(0, Number(at) - pane.shift)))
  }
}

// A picture carries its page's sheets, and matches every rule in them against
// every element before it paints: most of a sheet styles other pages. Only the
// rules that may match something in the picture are carried, read from the
// sheets the page has parsed: those with a branch whose every class and id
// the picture holds. Every rule no selector picks (a font, a keyframe) stays.
// A sheet the page can't read stays linked, for the worker to carry whole
// (./picture-sheets.ts).
let SHEETS = 'link[rel~="stylesheet"]'
// The classes and ids each branch of a selector asks every match to hold:
// those outside brackets and parentheses, where :not() and :is() can ask
// for less.
let needs = (selector: string) => {
  let flat = '', depth = 0
  for (let c of selector) {
    if (c == '(' || c == '[') depth++
    else if (c == ')' || c == ']') depth--
    else if (!depth) flat += c
  }
  return flat.split(',').map((branch) =>
    [...branch.matchAll(/([.#])((?:[\w-]|\\.)+)/g)].map(([, kind, name]) =>
      kind + name.replace(/\\(.)/g, '$1')
    )
  )
}
let held = (shown: Element) => {
  let names = new Set<string>()
  for (let e of [shown, ...shown.querySelectorAll('*')]) {
    if (e.id) names.add('#' + e.id)
    for (let c of e.classList) names.add('.' + c)
  }
  return names
}

// A sheet's rules as read once: reading them is most of the time a picture
// takes, and a page's sheets don't change while it is open. A rule's text is
// read once a picture carries it.
type Styled = { needs: string[][]; rule: CSSRule }
type Rule =
  | Styled
  | { group: string; rules: Rule[]; layer: boolean }
  | { rule: CSSRule }
let read = (rules: CSSRuleList): Rule[] =>
  [...rules].map((rule) => {
    if ('selectorText' in rule) {
      return { needs: needs(rule.selectorText as string), rule }
    }
    if (!('cssRules' in rule) || 'findRule' in rule) return { rule }
    // A group (@media, @supports, @layer, @container) and what is in it.
    return {
      group: rule.cssText.slice(0, rule.cssText.indexOf('{')),
      rules: read(rule.cssRules as CSSRuleList),
      layer: 'name' in rule,
    }
  })
let texts = new WeakMap<CSSRule, string>()
let text = (rule: CSSRule) => {
  let said = texts.get(rule)
  if (said == null) texts.set(rule, said = rule.cssText)
  return said
}
let readings = new WeakMap<CSSStyleSheet, Rule[]>()
let hits = (names: Set<string>, { needs }: Styled) =>
  needs.some((branch) => branch.every((n) => names.has(n)))
// A layer keeps its place in the order of layers even when empty.
let used = (names: Set<string>, rules: Rule[]): string =>
  rules.map((r) => {
    if ('needs' in r) return hits(names, r) ? text(r.rule) : ''
    if (!('group' in r)) return text(r.rule)
    let kept = used(names, r.rules)
    return kept || r.layer ? `${r.group}{${kept}}` : ''
  }).join('')
let carry = (
  win: Window,
  shown: Element,
  sheets: [Element, Element][],
) => {
  let names = held(shown)
  for (let [live, copy] of sheets) {
    let sheet = (live as HTMLLinkElement).sheet
    if (!sheet?.href || sheet.disabled) continue
    let rules = readings.get(sheet)
    try {
      if (!rules) readings.set(sheet, rules = read(sheet.cssRules))
    } catch {
      continue // another site's sheet
    }
    let style = win.document.createElement('style')
    let media = copy.getAttribute('media')
    if (media) style.setAttribute('media', media)
    style.textContent = absolute(used(names, rules), sheet.href)
    copy.replaceWith(style)
  }
}

// The element the address's fragment names, as the picture scrolls to it.
let linked = (win: Window) => {
  try {
    let id = decodeURIComponent(new URL(win.location.href).hash.slice(1))
    return id ? win.document.getElementById(id) : null
  } catch {
    return null // a malformed fragment names nothing
  }
}

// Clone retained branches in one piece when they need no changes. Copy the
// paths to omitted elements, scroll panes and linked sheets one node at a
// time so a long list never has to be cloned just to cut it back down.
let copyPicture = (
  root: Element,
  omitted: Set<Element>,
  positions: Map<Element, string>,
  sources: Set<Element>,
) => {
  let shallow = new Set<Element>()
  let path = (e: Element | null) => {
    for (; e && !shallow.has(e); e = e.parentElement) shallow.add(e)
  }
  for (let e of omitted) path(e.parentElement)
  for (let e of positions.keys()) path(e)
  for (let e of sources) path(e)
  let sheets: [Element, Element][] = []
  let copy = (e: Element): Element => {
    if (!shallow.has(e)) return e.cloneNode(true) as Element
    let shown = e.cloneNode(false) as Element
    let at = positions.get(e)
    if (at != null) shown.setAttribute(SCROLL, at)
    if (sources.has(e)) sheets.push([e, shown])
    for (let node of e.childNodes) {
      if (node.nodeType != 1) shown.appendChild(node.cloneNode(true))
      else if (!omitted.has(node as Element)) {
        shown.appendChild(copy(node as Element))
      }
    }
    return shown
  }
  return { shown: copy(root), sheets }
}

/** The snapshot of the page in `win` as it shows now, without what is not
 * shown, and its shell where it has parts of its own. */
export let snapshot = (win: Window): Snapshot => {
  let { documentElement: root, scrollingElement: page } = win.document
  let omitted = new Set(root.querySelectorAll(UNSEEN))
  let positions = new Map<Element, string>()
  let at = page?.scrollTop ? scroll(page) : root.getAttribute(SCROLL)
  if (at != null) positions.set(root, at)
  let panes = root.querySelectorAll(`[${SCROLL}]`)
  let holds = new Set<Element>()
  for (let pane of panes) {
    positions.set(pane, scroll(pane))
    for (
      let e: Element | null = pane;
      e && !holds.has(e);
      e = e.parentElement
    ) {
      holds.add(e)
    }
  }
  let view = reach(0, win.innerHeight)
  beyond(
    { win, target: linked(win), holds, omitted, positions },
    root,
    win.getComputedStyle(root),
    view,
  )
  unshift(positions, root, view)
  let { shown, sheets } = copyPicture(
    root,
    omitted,
    positions,
    new Set(root.querySelectorAll(SHEETS)),
  )
  carry(win, shown, sheets)
  let doc = (e: Element) => '<!doctype html>' + e.outerHTML
  let shell = shown.querySelector(`[${OWN}]`) &&
    shown.cloneNode(true) as Element
  for (let own of shell ? shell.querySelectorAll(`[${OWN}]`) : []) {
    own.replaceChildren()
  }
  return {
    keep: win.location.href,
    html: doc(shown),
    ...shell ? { shell: doc(shell) } : {},
    at: Date.now(),
    since: win.performance.timeOrigin,
  }
}

/** How long a page stands unchanged before it is kept. A snapshot taken as
 * a page is left runs after the next page's answer arrives and before that
 * page can paint, so it is taken while the page is quiet, and leaving finds
 * nothing changed. */
export let QUIET = 1_000

/** Register `worker` for the page in `win`, and keep the page with it.
 * A page matching `pending` is still opening. Keep it after the navigator
 * delivers its contents. */
export let keep = (win: Window, worker: string, pending?: string): void => {
  let workers = win.navigator.serviceWorker
  if (!workers || win.document.documentElement.hasAttribute(KEPT)) return
  let loaded = false, seeded = false
  // A page going away is left, hidden and unloaded in turn. Its snapshot is
  // taken again only when what it shows changed since the last.
  let changed = true
  let quiet: number | undefined
  let changes = new win.MutationObserver((records) => {
    if (records.some(changing)) change()
  })
  let change = () => {
    changed = true
    win.clearTimeout(quiet)
    quiet = win.setTimeout(settled, QUIET)
  }
  let settled = () => {
    if (!loaded || win.document.visibilityState == 'hidden') return
    if (win.requestIdleCallback) {
      win.requestIdleCallback(send, { timeout: QUIET })
    } else send()
  }
  changes.observe(win.document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  win.addEventListener('scroll', change, { capture: true, passive: true })
  win.addEventListener('resize', change)
  let send = () => {
    let root = win.document.documentElement
    if (changes.takeRecords().some(changing)) changed = true
    if (
      !changed || !workers.controller || root.hasAttribute(KEPT) ||
      root.querySelector(`[${LIVE}]`) || pending && root.querySelector(pending)
    ) return
    workers.controller.postMessage(snapshot(win))
    seeded = true
    changed = false
  }
  let seed = () => {
    if (loaded && !seeded) send()
  }
  // Keep the loaded page even if the browser later discards it without
  // running a leave handler. Start registration after the page's own files.
  let start = () => {
    loaded = true
    if (workers.controller) seed()
    else workers.addEventListener('controllerchange', seed, { once: true })
    workers.register(worker).catch((e) => win.reportError?.(e))
  }
  if (win.document.readyState == 'complete') start()
  else win.addEventListener('load', start)
  win.document.addEventListener(PAGE, seed)
  // Taken and sent at once: a page being hidden may not run again. A page
  // going away is hidden and unloaded in turn, while the next page waits to
  // parse: it is taken once for both, until it shows again.
  let left = false
  let leave = () => {
    if (left) return
    left = true
    send()
  }
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState == 'hidden') leave()
    else left = false
  })
  win.document.addEventListener(LEAVE, send)
  win.addEventListener('pagehide', leave)
  win.addEventListener('pageshow', () => left = false)
}
