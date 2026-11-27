/**
 * Updates cards in the browser (D-475 step 4), a space's or every space's
 * together. The page is drawn from the person's rows (./updates-view.ts
 * `cardsView`), and here the cards are drawn again from the tab's page graph
 * as the rows move: an update an Operator writes shows at once, and one
 * answered or dismissed elsewhere changes. A card keeps its actions' id and what its person opened, and an
 * update that was new when the page opened stays marked new while it is
 * open. Each redraw is said on the view (@yaks/inbox `REDRAWN`), so the
 * card actions paint again what they hold.
 *
 * The view is `[data-view="updates"]`, saying what it draws for in
 * `data-updates-view` (`UpdatesView`).
 *
 * @module
 */
import { createElement as h, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import type { Client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { updateCards, updateOffers, updateWords } from './update-rows.ts'
import { appsOf, sideApps, sideWords } from './side-rows.ts'
import {
  type Apps,
  cardsView,
  type Placed,
  placedIn,
  type UpdatesView,
} from './updates-view.ts'
import { drawn, pageGraph } from './page-graph.ts'
import { REDRAWN } from '@yaks/inbox/actions-browser'
// The day's lines beside the cards, where Updates show in place.
import './updates-day-browser.ts'

/** The Updates cards view. */
export let VIEW = '[data-view="updates"]'

let made = (doc: Document, node: ReactNode) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// What a redraw leaves as it is: what the person opened, and the rows the
// page carried for its first paint.
let KEPT = {
  keeps: (_: Element, name: string) => name == 'open',
  leave: (n: Node) => (n as Element).localName == 'script',
}

let CARD = '[data-key][data-inbox-card]'

// Each card of `next` that stands in `root` takes its id for its actions,
// which hold what was done on it.
let keepIds = (root: HTMLElement, next: HTMLElement) => {
  let ids = new Map(
    [...root.querySelectorAll<HTMLElement>(CARD)].map((c) => [
      c.dataset.key,
      c.dataset.inboxCard!,
    ]),
  )
  for (let card of next.querySelectorAll<HTMLElement>(CARD)) {
    let id = ids.get(card.dataset.key)
    if (id) card.dataset.inboxCard = id
  }
}

// Only app titles and addresses are used by the cards.
let links = (rows: Bundle[], space: string): Apps =>
  appsOf(rows, space).map(({ eid, slug, title }) => ({ eid, slug, title }))

let reading = (updates: Placed[], apps: Apps[]) =>
  JSON.stringify([updates, apps])

/** Keep the cards view `root` drawn from `graph`; the answer lets go. */
export let bindUpdates = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
): () => void => {
  let view = JSON.parse(root.dataset.updatesView!) as UpdatesView
  let lines = view.spaces.map(({ eid }) => ({
    eid,
    news: [graph.watch(updateCards(eid)), graph.watch(updateOffers(eid))],
    apps: graph.watch(sideApps(eid)),
  }))
  let watched = lines.flatMap((l) => [...l.news, l.apps])
  let held = () =>
    placedIn(lines.flatMap((l) => l.news.flatMap((w) => w.value)), view.spaces)
  let was = drawn(view.person, root)
  let opening = was ? placedIn(was.rows, view.spaces) : held()
  // New when the page opened, which opening it read.
  let fresh = new Set(opening.filter((u) => u.unread).map((u) => u.eid))
  let last = was
    ? reading(opening, lines.map((l) => links(was.rows, l.eid)))
    : ''
  let draw = () => {
    // The cards and their links are drawn together. A refused read keeps
    // what it last said.
    if (!watched.every((w) => w.ready || w.refused)) return
    let updates = held().map((u) =>
      fresh.has(u.eid) ? { ...u, unread: true } : u
    )
    let shelves = lines.map((l) => links(l.apps.value, l.eid))
    let said = reading(updates, shelves)
    if (said == last) return
    last = said
    let apps = new Map(lines.map((l, i) => [l.eid, shelves[i]]))
    let next = root.cloneNode(false) as HTMLElement
    next.append(
      made(
        root.ownerDocument,
        cardsView(
          view,
          updates,
          (space) => apps.get(space.eid) ?? [],
        ),
      ),
    )
    keepIds(root, next)
    morph(root, next, KEPT)
    let { Event } = root.ownerDocument.defaultView ?? globalThis
    root.dispatchEvent(new Event(REDRAWN, { bubbles: true }))
  }
  let off = watched.map((w) => w.subscribe(draw))
  return () => {
    for (let stop of off) stop()
    for (let w of watched) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.updatesView!) as UpdatesView
      let stop = bindUpdates(
        root,
        pageGraph([updateWords, sideWords], person),
      )
      leaving(doc).addEventListener('abort', () => {
        bound.delete(root)
        stop()
      }, { once: true })
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
