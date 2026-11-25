/**
 * A space's Apps page in the browser (D-475 step 5). The page is drawn from
 * the person's rows (./space-apps-view.ts), and here it is drawn again from
 * the tab's page graph as they move: an app made, renamed, deployed or trashed
 * elsewhere, a break, an agent connected. A long list narrows as a person
 * types and orders as they pick, drawn again from the same rows, and the
 * address keeps what was asked, so a reload shows the same. Each copy button
 * puts its words on the clipboard.
 *
 * The view is `[data-view="apps"]`, saying what it draws for in
 * `data-apps-view` (`AppsView`).
 *
 * @module
 */
import { type ComponentChildren, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import { copying, shown } from '@yaks/ui/copy-browser'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { pageGraph } from './page-graph.ts'
import { AGENTS, agentsOf, agentsWords } from './agents.ts'
import {
  brokenApps,
  listedOf,
  spaceApps,
  spaceAppsWords,
} from './space-apps.ts'
import { type AppsView, appsView } from './space-apps-view.ts'

/** The Apps view. */
export let VIEW = '[data-view="apps"]'

let made = (doc: Document, node: ComponentChildren) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

// What the search and the order ask, kept in the address: none where they
// ask nothing, and the order it opens in is not said.
let asked = (sift: AppsView['sift'], href: string) => {
  let to = new URL(href)
  for (let [key, value] of Object.entries(sift)) {
    if (value && !(key == 'sort' && value == 'changed')) {
      to.searchParams.set(key, value)
    } else to.searchParams.delete(key)
  }
  return to
}

/** Keep the Apps view `root` drawn from `graph`. The answer lets go of it
 * all. */
export let bindApps = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
  win: Pick<Window, 'location' | 'history'> = globalThis,
): () => void => {
  let view = JSON.parse(root.dataset.appsView!) as AppsView
  let space = view.space.eid
  let watches = {
    apps: graph.watch(spaceApps(space)),
    broken: graph.watch(brokenApps(space)),
    agents: graph.watch(AGENTS),
  }
  // Nothing until the apps are in; what is broken and the agents fill in
  // as each answers.
  let draw = () => {
    if (!watches.apps.ready) return
    let next = root.cloneNode(false) as HTMLElement
    next.append(made(
      root.ownerDocument,
      appsView(view, {
        apps: listedOf(watches.apps.value, space, watches.broken.value),
        agents: agentsOf(watches.agents.value)?.length,
      }),
    ))
    morph(root, next, KEPT)
    shown(root)
  }
  let sift = (e: Event) => {
    let form = (e.target as Element).closest<HTMLFormElement>(
      'form[data-find-apps]',
    )
    if (!form) return
    if (e.type == 'submit') e.preventDefault()
    let field = (name: string) =>
      form.querySelector<HTMLInputElement>(`[name=${name}]`)?.value ?? ''
    view.sift = { q: field('q'), sort: field('sort') }
    win.history.replaceState(
      win.history.state,
      '',
      asked(view.sift, win.location.href),
    )
    draw()
  }
  let all = Object.values(watches)
  let off = all.map((w) => w.subscribe(draw))
  root.addEventListener('input', sift)
  root.addEventListener('submit', sift)
  let uncopy = copying(root)
  draw()
  return () => {
    root.removeEventListener('input', sift)
    root.removeEventListener('submit', sift)
    uncopy()
    for (let stop of off) stop()
    for (let w of all) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.appsView!) as AppsView
      let stop = bindApps(
        root,
        pageGraph([spaceAppsWords, agentsWords], person),
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
