/**
 * A space's Dashboard in the browser (T-3702, D-475). The view is drawn from
 * its rows (./dashboard-view.ts), and here it is drawn again from the tab's
 * page graph as they move: an app released or renamed, a fix the Operator
 * made, an update answered elsewhere.
 *
 * A Dashboard standing hidden beside another view of an Operator page
 * (./talk-views.ts) watches nothing until it is first shown. Pressing a
 * suggestion writes its longer request in the box to the Operator, to change
 * and send. Dismissing one writes `dismissSuggestion{space, name}` through
 * the graph, so it is gone in the frame it was pressed in, and for good once
 * the door has kept it; a refusal puts it back.
 *
 * The view is `[data-view="dashboard"]`, saying what it draws for in
 * `data-dashboard-view` (`DashboardView`).
 *
 * @module
 */
import { createElement as h, Fragment } from 'react'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { actionWords, REDRAWN } from '@yaks/inbox/actions-browser'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { drawn, pageGraph } from './page-graph.ts'
import {
  agentWork,
  dashboardWords,
  dismissal,
  operatorFixes,
  suggestions,
} from './dashboard.ts'
import {
  type Dashboard,
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

let paint = (
  root: HTMLElement,
  view: DashboardView,
  read: Dashboard,
): void => {
  let t = root.ownerDocument.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, dashboardView(view, read)))
  let next = root.cloneNode(false) as HTMLElement
  next.append(t.content)
  morph(root, next, KEPT)
  root.dispatchEvent(
    new (root.ownerDocument.defaultView ?? globalThis).Event(REDRAWN, {
      bubbles: true,
    }),
  )
}

/** Draw `root` again from `rows`, as `view` asks it. */
export let drawDashboard = (
  root: HTMLElement,
  view: DashboardView,
  rows: Bundle[],
  pending = false,
): void => paint(root, view, dashboardOf(view, rows, pending))

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
  let remote = dashboardLines(eid).map((line) => graph.watch(line))
  let dismissals = graph.watch(`.dismissSuggestion.space=${eid}`, {
    remote: false,
  })
  let watches = [...remote, dismissals]
  let held = drawn(view.person, root)?.rows
  let said = held && JSON.stringify(dashboardOf(view, held))
  // The server's panels stand until the live reads answer. Dismissals are
  // local and can change those panels while the reads are still coming in.
  let draw = () => {
    if (held && remote.every((w) => w.ready || w.refused)) held = undefined
    let rows = held ?? remote.flatMap((w) => w.value)
    let pending = !held && !remote[0].ready && !remote[0].value.length
    let read = dashboardOf(view, [...rows, ...dismissals.value], pending)
    let next = JSON.stringify(read)
    if (next == said) return
    said = next
    paint(root, view, read)
  }
  let click = (e: Event) => {
    let pressed = e.target as Element
    let ask = pressed.closest<HTMLElement>('a[data-ask]')
    let box = root.querySelector<HTMLTextAreaElement>('.Dash_AskBox')
    if (ask && box) {
      e.preventDefault()
      box.value = ask.dataset.ask!
      box.focus()
      box.setSelectionRange?.(box.value.length, box.value.length)
      return
    }
    let button = pressed.closest<HTMLButtonElement>('button[data-dismiss]')
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
