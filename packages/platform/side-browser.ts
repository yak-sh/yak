/**
 * yaks.app's sidebar drawn again in the browser from the tab's page graph
 * (D-475 step 2). The server draws the side with the person's spaces and the
 * apps of the space it is in (./side-parts.ts `sideParts`) and writes what it
 * needs to draw them again on it (`data-side-view`). Here the page graph
 * watches the same rows (./side-rows.ts) and the Updates waiting on the
 * person (./update-waiting.ts), and each time they change the side's
 * selector, its Updates across spaces and its apps are drawn from them and
 * laid over the ones on screen (@yaks/ui/navigate `morph`). The rest of the
 * side is the page's.
 *
 * A watch that has not answered leaves what the server drew. On reconnect,
 * the badges keep their last answer while the count watch resyncs.
 *
 * @module
 */
import { createElement as h, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import type { Bundle } from '@yaks/graph'
import type { Client, Watch } from '@yaks/client'
import { morph, PAGE } from '@yaks/ui/navigate'
import { section, sideParts, type SideView } from './side-parts.ts'
import { appsOf, pickedOf, SIDE_SPACES, sideApps } from './side-rows.ts'
import { UPDATE_WAITING, waitingCounts } from './update-waiting.ts'

// A selector the person holds open stays open.
let OPEN = { keeps: (_: Element, name: string) => name == 'open' }

/** The side drawn from rows: the element that says how. */
export let SIDE = '[data-side-view]'

// The element `node` draws, in `doc`.
let made = (doc: Document, node: ReactNode) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content.firstElementChild!
}

// Lay `next` over the region `part` of `root`, or put it in before `before`
// where the page has none, or take the region away where `next` is none.
let place = (
  root: Element,
  part: string,
  next: Element | null,
  before?: string,
) => {
  let was = root.querySelector(`[data-side-part="${part}"]`)
  if (was && next) morph(was, next)
  else if (was) was.remove()
  else if (next && before) {
    let at = root.querySelector(before)
    at?.parentNode?.insertBefore(next, at)
  }
}

/** Draw `root`'s parts again from `rows`: the spaces, the apps of its space,
 * and the Updates waiting, each where its watch has answered. */
export let drawSide = (
  root: HTMLElement,
  view: SideView,
  rows: { spaces?: Bundle[]; apps?: Bundle[]; waiting?: Bundle[] },
): void => {
  if (!rows.spaces) return
  let doc = root.ownerDocument
  let collapsed = root.classList.contains('Sidebar-rail')
  let counts = rows.waiting && waitingCounts(rows.waiting)
  let apps = view.talk && rows.apps ? appsOf(rows.apps, view.talk.space) : []
  let parts = sideParts(view, pickedOf(rows.spaces), apps, counts)
  let whose = root.querySelector('.Sidebar_Whose')
  if (whose) {
    morph(
      whose,
      made(doc, h('div', { className: 'Sidebar_Whose' }, parts.picker)),
      OPEN,
    )
  }
  if (!view.talk) return
  place(
    root,
    'side-personal',
    parts.personal ? made(doc, section(parts.personal, collapsed)) : null,
    '.Sidebar_Space',
  )
  if (rows.apps && parts.apps) {
    place(root, 'side-apps', made(doc, section(parts.apps, collapsed)))
  }
}

/** Keep the side of each page the navigator lays in drawn from the tab's
 * page graph, `graph` for the person the page was drawn for. */
export let bindSide = (
  doc: Document,
  graph: (person: string) => Pick<Client, 'watch'>,
): () => void => {
  let held: { key: string; watches: Watch[]; waiting?: Bundle[] } | undefined
  let close = () => {
    for (let w of held?.watches ?? []) w.close()
    held = undefined
  }
  let viewOf = (root: HTMLElement | null): SideView | undefined => {
    let said = root?.dataset.sideView
    return said ? JSON.parse(said) : undefined
  }
  let draw = () => {
    let root = doc.querySelector<HTMLElement>(SIDE)
    let view = viewOf(root)
    if (!root || !view || !held) return
    let [spaces, apps, waiting] = held.watches
    let rows = (w?: Watch) => w?.ready ? w.value : undefined
    if (waiting?.ready) held.waiting = waiting.value
    drawSide(root, view, {
      spaces: rows(spaces),
      apps: rows(apps),
      waiting: held.waiting,
    })
  }
  let page = () => {
    let view = viewOf(doc.querySelector<HTMLElement>(SIDE))
    let lines = view
      ? [
        SIDE_SPACES,
        ...view.talk ? [sideApps(view.talk.space), UPDATE_WAITING] : [],
      ]
      : []
    let key = view ? [view.person, ...lines].join(' ') : ''
    if (key != held?.key) {
      close()
      if (view) {
        // In the order `draw` takes them: spaces, apps, waiting.
        let watches = lines.map((line) => graph(view.person).watch(line))
        held = { key, watches }
        for (let w of watches) w.subscribe(draw)
      }
    }
    draw()
  }
  page()
  doc.addEventListener(PAGE, page)
  return () => {
    doc.removeEventListener(PAGE, page)
    close()
  }
}
