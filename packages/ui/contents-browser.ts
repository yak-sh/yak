/**
 * What a contents list (@yaks/ui `Contents`) does in a browser. `fill` makes
 * an empty one's entries from the headings its `data-contents` selector names,
 * giving each an anchor from its words where it has none. `watch` lights the
 * entry of the section in view as the page scrolls, with an
 * IntersectionObserver and no scroll handler, and closes a phone's menu once
 * an entry in it is pressed. Loading the module does both for every contents
 * list on the page, and follows a `#section` address to an anchor made here.
 *
 * `current` is the choice itself, kept pure: given which headings are at or
 * above the top of the view, the one whose section is in view.
 *
 * @module
 */

import type { Entry } from './Contents.ts'

/** Fewer sections than this need no contents: the page shows them all. */
export let FEW = 3

/** The section in view: the last of the headings, in the page's order, that
 * has reached the band at the top of the view, else the first. */
export let current = (passed: boolean[]): number =>
  Math.max(passed.lastIndexOf(true), 0)

/** An anchor from a heading's words: lower case, a hyphen between words. */
export let anchor = (words: string): string =>
  words.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'

// Whether a heading is on the page to be read: not in a closed fold, a
// dialog, or anything else not drawn.
let shown = (el: Element) =>
  !el.closest('dialog, details:not([open]), [hidden]')

/** The headings a selector names under `root`, each with an anchor: its own,
 * or one made from its words, unique on the page. */
export let headings = (root: ParentNode, from: string): Entry[] => {
  let doc = (root as Node).ownerDocument ?? (root as Document)
  return [...root.querySelectorAll(from)].filter(shown).map((el) => {
    let label = el.textContent?.trim().replace(/\s+/g, ' ') ?? ''
    if (!el.id) {
      let id = anchor(label), n = 1
      while (doc.getElementById(n == 1 ? id : `${id}-${n}`)) n++
      el.id = n == 1 ? id : `${id}-${n}`
    }
    return { id: el.id, label, sub: el.tagName == 'H3' }
  })
}

// One list's entries, written into the frame `contents` drew.
let draw = (list: Element, entries: Entry[]) => {
  let doc = list.ownerDocument
  list.replaceChildren(...entries.map((e) => {
    let item = doc.createElement('li')
    item.className = e.sub ? 'Contents_Item Contents_Item-sub' : 'Contents_Item'
    let link = doc.createElement('a')
    link.className = 'Contents_Link'
    link.href = `#${e.id}`
    link.textContent = e.label
    item.append(link)
    return item
  }))
}

/** Fill a contents list drawn empty from the headings its `data-contents`
 * names, under `root`; one with too few sections stays hidden. */
export let fill = (nav: HTMLElement, root: ParentNode): void => {
  let from = nav.dataset.contents
  if (!from) return
  let entries = headings(root, from)
  for (let list of nav.querySelectorAll('.Contents_List')) draw(list, entries)
  nav.hidden = entries.length < FEW
}

// Light the entry for `id`, in both lists.
let light = (nav: Element, id: string) => {
  for (let link of nav.querySelectorAll<HTMLAnchorElement>('.Contents_Link')) {
    let on = link.hash == `#${id}`
    link.classList.toggle('Contents_Link-on', on)
    if (on) link.setAttribute('aria-current', 'location')
    else link.removeAttribute('aria-current')
  }
}

/** Light the entry of the section in view as the page scrolls. The band is
 * the top quarter of the view: a heading that has reached it has begun the
 * section being read. */
export let watch = (nav: HTMLElement): void => {
  let doc = nav.ownerDocument
  let links = [...nav.querySelectorAll<HTMLAnchorElement>('.Contents_List')]
    .at(0)?.querySelectorAll<HTMLAnchorElement>('.Contents_Link') ?? []
  let targets = [...links].map((a) =>
    doc.getElementById(decodeURIComponent(a.hash.slice(1)))
  ).filter((el): el is HTMLElement => !!el)
  if (!targets.length) return
  let passed = targets.map(() => false)
  let seen = new IntersectionObserver((entries) => {
    for (let e of entries) {
      let at = targets.indexOf(e.target as HTMLElement)
      passed[at] = e.isIntersecting ||
        e.boundingClientRect.top < (e.rootBounds?.top ?? 0)
    }
    light(nav, targets[current(passed)].id)
  }, { rootMargin: '0px 0px -75% 0px' })
  for (let el of targets) seen.observe(el)
  let menu = nav.querySelector('details')
  menu?.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) menu.open = false
  })
}

/** Every contents list on the page, filled and watched; and an address's
 * `#section` followed, where its anchor was only made now. */
export let start = (doc: Document): void => {
  let navs = [...doc.querySelectorAll<HTMLElement>('.Contents')]
  for (let nav of navs) {
    fill(nav, nav.closest('[data-contents-root]') ?? doc)
    if (!nav.hidden) watch(nav)
  }
  let to = decodeURIComponent(location.hash.slice(1))
  if (to) doc.getElementById(to)?.scrollIntoView()
}

if (typeof document != 'undefined' && typeof location != 'undefined') {
  start(document)
}
