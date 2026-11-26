/**
 * A space's Dashboard in the browser (T-3702, D-475). The view is drawn from
 * its rows (./dashboard-view.ts), and here it is drawn again from the tab's
 * page graph as they move: an app released or renamed, a fix the Operator
 * made, an update answered elsewhere.
 *
 * A Dashboard standing hidden beside another view of an Operator page
 * (./talk-views.ts) watches nothing until it is first shown. Dismissing a
 * suggestion writes `dismissSuggestion{space, name}` through the graph, so
 * it is gone in the frame it was pressed in, and for good once the door has
 * kept it; a refusal puts it back.
 *
 * The view is `[data-view="dashboard"]`, saying what it draws for in
 * `data-dashboard-view` (`DashboardView`).
 *
 * @module
 */
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { actionWords, REDRAWN } from '@yaks/inbox/actions-browser'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { pageGraph } from './page-graph.ts'
import {
  agentWork,
  dashboardWords,
  dismissal,
  operatorFixes,
  suggestions,
} from './dashboard.ts'
import {
  dashboardOf,
  type DashboardView,
  dashboardView,
  VIEW_ATTR,
} from './dashboard-view.ts'
import { spaceApps, spaceAppsWords } from './space-apps.ts'
import { updateCards, updateOffers, updateWords } from './update-rows.ts'
import { VIEW as TALK_VIEW, VIEWED } from './talk-views.ts'

/** The Dashboard's view. */
export let VIEW = '[data-view="dashboard"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** Draw `root` again from `rows`, as `view` asks it. */
export let drawDashboard = (
  root: HTMLElement,
  view: DashboardView,
  rows: Bundle[],
  pending = false,
): void => {
  let t = root.ownerDocument.createElement('template')
  t.innerHTML = renderToString(
    h(Fragment, null, dashboardView(view, dashboardOf(view, rows, pending))),
  )
  let next = root.cloneNode(false) as HTMLElement
  next.append(t.content)
  morph(root, next, KEPT)
  root.dispatchEvent(
    new (root.ownerDocument.defaultView ?? globalThis).Event(REDRAWN, {
      bubbles: true,
    }),
  )
}

/** The lines the Dashboard of the space `eid` watches. */
export let dashboardLines = (eid: string): string[] => [
  spaceApps(eid),
  agentWork(eid),
  operatorFixes(eid),
  suggestions(eid),
  updateCards(eid),
  updateOffers(eid),
]

/** Keep the Dashboard `root` drawn from `graph`, and take its dismissals
 * through it. The answer lets go of it all. */
export let bindDashboard = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
): () => void => {
  let view = JSON.parse(root.getAttribute(VIEW_ATTR)!) as DashboardView
  let { eid } = view.space
  let watches = [
    ...dashboardLines(eid).map((line) => graph.watch(line)),
    graph.watch(`.dismissSuggestion.space=${eid}`, { remote: false }),
  ]
  let said = ''
  // Its apps say whether it is in: until they answer, the rows it was drawn
  // from stand, or its frame.
  let draw = () => {
    let rows = watches.flatMap((w) => w.value ?? [])
    let pending = !watches[0].ready && !watches[0].value.length
    let next = JSON.stringify([pending, rows])
    if (next == said) return
    said = next
    drawDashboard(root, view, rows, pending)
  }
  let click = (e: Event) => {
    let button = (e.target as Element).closest<HTMLButtonElement>(
      'button[data-dismiss]',
    )
    if (!button) return
    let gone = dismissal(eid, button.dataset.dismiss!)
    Promise.resolve(graph.mutate([gone])).catch((error: unknown) =>
      globalThis.reportError?.(error)
    )
  }
  root.addEventListener('click', click)
  let offs = watches.map((w) => w.subscribe(draw))
  draw()
  return () => {
    root.removeEventListener('click', click)
    for (let off of offs) off()
    for (let w of watches) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let bind = (root: HTMLElement) => {
    if (bound.has(root)) return
    bound.add(root)
    let { person } = JSON.parse(root.getAttribute(VIEW_ATTR)!) as DashboardView
    let stop = bindDashboard(
      root,
      pageGraph(
        [dashboardWords, spaceAppsWords, updateWords, ...actionWords],
        person,
      ),
    )
    leaving(doc).addEventListener('abort', () => {
      bound.delete(root)
      stop()
    }, { once: true })
  }
  // A Dashboard standing hidden beside another view starts once shown.
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      let talk = root.closest<HTMLElement>(`[${TALK_VIEW}]`)
      // A link to the space's address from before its chat moved under
      // `/operator` named a line of the chat by its hash, which only the
      // browser sees: it opens that line in the chat still.
      let { hash } = doc.defaultView?.location ?? {}
      if (!talk?.hidden && hash?.startsWith('#row-')) {
        let { chat } = JSON.parse(
          root.getAttribute(VIEW_ATTR)!,
        ) as DashboardView
        doc.defaultView!.location.replace(chat + hash)
        return
      }
      if (!talk?.hidden) bind(root)
      else {
        talk.addEventListener(VIEWED, () => talk.hidden || bind(root), {
          signal: leaving(doc),
        })
      }
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
