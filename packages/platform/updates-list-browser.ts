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
import { type ComponentChildren, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { updateCards, updateOffers, updateWords } from './update-rows.ts'
import { appsOf, sideApps, sideWords } from './side-rows.ts'
import { cardsView, placedIn, type UpdatesView } from './updates-view.ts'
import { pageGraph } from './page-graph.ts'
import { REDRAWN } from '@yaks/inbox/actions-browser'

/** The Updates cards view. */
export let VIEW = '[data-view="updates"]'

let made = (doc: Document, node: ComponentChildren) => {
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
  // New when the page opened, which opening it read.
  let fresh = new Set(held().filter((u) => u.unread).map((u) => u.eid))
  // What the cards were last drawn from: a write that moves none of it
  // (another line's, or what is already drawn) draws nothing.
  let drawn = ''
  let draw = () => {
    // Each line answered, or refused: a space whose Operator is away
    // keeps what it last said.
    if (!lines.every((l) => l.news.every((w) => w.ready || w.refused))) return
    let updates = held().map((u) =>
      fresh.has(u.eid) ? { ...u, unread: true } : u
    )
    let said = JSON.stringify([updates, lines.map((l) => l.apps.value)])
    if (said == drawn) return
    drawn = said
    let apps = new Map(lines.map((l) => [l.eid, l.apps]))
    let next = root.cloneNode(false) as HTMLElement
    next.append(
      made(
        root.ownerDocument,
        cardsView(
          view,
          updates,
          (space) => appsOf(apps.get(space.eid)?.value ?? [], space.eid),
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
