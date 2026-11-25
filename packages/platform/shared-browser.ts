/**
 * The Shared with you page in the browser (D-475 step 5). The page is drawn
 * from the apps others let the person into (./shared-view.ts), and here it is
 * drawn again from the tab's page graph as they move: an app someone shares
 * or stops sharing, renames or puts in the trash shows at once.
 *
 * The view is `[data-view="shared"]`, saying what it draws for in
 * `data-shared-view` (`SharedView`).
 *
 * @module
 */
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { accountWords, SHARED_APPS, sharedOf } from './account-rows.ts'
import { pageGraph } from './page-graph.ts'
import { type SharedView, sharedView } from './shared-view.ts'

/** The Shared with you view. */
export let VIEW = '[data-view="shared"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from the apps `rows` hold. */
export let drawShared = (
  root: HTMLElement,
  view: SharedView,
  rows: Bundle[],
): void => {
  let next = root.cloneNode(false) as HTMLElement
  let t = root.ownerDocument.createElement('template')
  t.innerHTML = renderToString(
    h(Fragment, null, sharedView(view, sharedOf(rows))),
  )
  next.append(t.content)
  morph(root, next, KEPT)
}

/** Keep the Shared with you view `root` drawn from `graph`; the answer lets
 * go. */
export let bindShared = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
): () => void => {
  let view = JSON.parse(root.dataset.sharedView!) as SharedView
  let apps = graph.watch(SHARED_APPS)
  // A line neither answered nor carried by the page leaves what is drawn.
  let draw = () =>
    (apps.ready || apps.value.length > 0) &&
    drawShared(root, view, apps.value)
  let off = apps.subscribe(draw)
  draw()
  return () => {
    off()
    apps.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.sharedView!) as SharedView
      let stop = bindShared(root, pageGraph([accountWords], person))
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
