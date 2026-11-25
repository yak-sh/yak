/**
 * A space's Visits page in the browser (D-475 step 5). The page is drawn from
 * the space's apps and their views (./visits-view.ts), and here it is drawn
 * again from the tab's page graph as they move: an app made, renamed or put
 * in the trash elsewhere, and the views the door reads again for it.
 *
 * The view is `[data-view="visits"]`, saying what it draws for in
 * `data-visits-view` (`VisitsView`).
 *
 * @module
 */
import { type ComponentChildren, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { pageGraph } from './page-graph.ts'
import { appsOf, sideApps, sideWords } from './side-rows.ts'
import { countsOf, visitCounts, visitWords } from './visit-counts.ts'
import { type VisitsView, visitsView } from './visits-view.ts'

/** The Visits view. */
export let VIEW = '[data-view="visits"]'

let made = (doc: Document, node: ComponentChildren) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from the space's apps and their views. */
export let drawVisits = (
  root: HTMLElement,
  view: VisitsView,
  rows: { apps: Bundle[]; counts: Bundle[] },
): void => {
  let next = root.cloneNode(false) as HTMLElement
  next.append(
    made(
      root.ownerDocument,
      visitsView(
        view,
        appsOf(rows.apps, view.space),
        countsOf(rows.counts, view.space),
      ),
    ),
  )
  morph(root, next, KEPT)
}

/** Keep the Visits view `root` drawn from `graph`; the answer lets go. */
export let bindVisits = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
): () => void => {
  let view = JSON.parse(root.dataset.visitsView!) as VisitsView
  let apps = graph.watch(sideApps(view.space))
  let counts = graph.watch(visitCounts(view.space))
  // A line neither answered nor carried by the page leaves what is drawn.
  let held = (w: typeof apps) => w.ready || w.value.length > 0
  let draw = () =>
    held(apps) && held(counts) &&
    drawVisits(root, view, { apps: apps.value, counts: counts.value })
  let off = [apps.subscribe(draw), counts.subscribe(draw)]
  draw()
  return () => {
    for (let stop of off) stop()
    apps.close()
    counts.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.visitsView!) as VisitsView
      let stop = bindVisits(root, pageGraph([sideWords, visitWords], person))
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
