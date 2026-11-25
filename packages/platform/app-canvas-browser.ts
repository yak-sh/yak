/**
 * The app open beside the chat, in the browser (D-475 step 5). The server
 * draws it from the side's row of the app (./app-canvas-view.ts), and here it
 * is drawn again from the tab's page graph as its rows move: the app renamed,
 * released or given an icon (`sideApps`), and what it is made of as the
 * Operator works on it (`appMaking`), which fills in the parts the first
 * paint left busy.
 *
 * Drawn again, the canvas keeps what the person did in it: the tab they
 * picked stays until a newer stage of making it is reached, the screens they
 * switched to stay, and a frame's address stays where its page has gone,
 * while the frame stays the same.
 *
 * The view is `[data-view="app-canvas"]`, saying what it draws for in
 * `data-canvas-view` (`CanvasRoot`).
 *
 * @module
 */
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { pageGraph } from './page-graph.ts'
import { appsOf, sideApps, sideWords } from './side-rows.ts'
import { appCanvasWords, appMaking, makingOf } from './app-canvas.ts'
import { appCanvas, canvasAttrs, type CanvasRoot } from './app-canvas-view.ts'

/** The app canvas view. */
export let VIEW = '[data-view="app-canvas"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** The rows the canvas is drawn from. */
export type Held = { apps: Bundle[]; making: Bundle[] }

let radios = (root: Element, name: string) => [
  ...root.querySelectorAll<HTMLInputElement>(`[name=${name}]`),
]

// The value of the radio of `name` that is checked.
let checked = (root: Element, name: string) =>
  radios(root, name).find((i) => i.checked)?.value

// Check the radio of `name` valued `value`, if there is one, and no other.
let check = (root: Element, name: string, value?: string) => {
  let all = radios(root, name)
  let input = all.find((i) => i.value == value)
  if (input) { for (let i of all) i.checked = i == input }
  return input
}

// Where each frame's page has gone (public/frames.js keeps its address), by
// which frame, with the address the frame was opened at.
let addresses = (root: Element) =>
  new Map(
    [...root.querySelectorAll<HTMLAnchorElement>('[data-address]')].map(
      (a) => [a.dataset.address!, {
        href: a.href,
        src: root.querySelector(`iframe[data-frame="${a.dataset.address}"]`)
          ?.getAttribute('src'),
      }],
    ),
  )

/** Draw `root` again from the rows its graph holds; nothing where the app is
 * not among the side's rows. */
export let drawCanvas = (root: HTMLElement, held: Held): void => {
  let view = JSON.parse(root.dataset.canvasView!) as CanvasRoot
  let app = appsOf(held.apps, view.space).find((a) => a.eid == view.app.eid)
  if (!app) return
  let next: CanvasRoot = { ...view, app }
  let doc = root.ownerDocument
  let t = doc.createElement('template')
  t.innerHTML = renderToString(
    h(
      Fragment,
      null,
      appCanvas(next, makingOf(held.making, app.eid), canvasAttrs(next)),
    ),
  )
  let drawn = t.content.firstElementChild as HTMLElement
  let stage = root.dataset.stage
  let picked = { made: checked(root, 'made'), screen: checked(root, 'screen') }
  let went = addresses(root)
  morph(root, drawn, KEPT)
  // A newer stage opens as it is reached; until then the person's pick stays.
  check(
    root,
    'made',
    root.dataset.stage == stage ? picked.made : root.dataset.stage,
  )
  check(root, 'screen', picked.screen)
  for (let [which, now] of addresses(root)) {
    let was = went.get(which)
    if (!was || was.src != now.src || was.href == now.href) continue
    let a = root.querySelector<HTMLAnchorElement>(
      `[data-address="${which}"]`,
    )!
    a.href = a.textContent = was.href
  }
  let open = root.querySelector<HTMLAnchorElement>('[data-open]')
  let shown = root.querySelector<HTMLAnchorElement>(
    `[data-address="${checked(root, 'screen') ?? 'live'}"]`,
  ) ?? root.querySelector<HTMLAnchorElement>('[data-address]')
  if (open && shown) open.href = shown.href
}

/** Keep the canvas `root` drawn from `graph`. A page chosen in Commands opens
 * in its frame by itself (its link's target); Screens, and that frame among
 * them, come forward with it. The answer lets go of it all. */
export let bindCanvas = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
): () => void => {
  let view = JSON.parse(root.dataset.canvasView!) as CanvasRoot
  let watches = {
    apps: graph.watch(sideApps(view.space)),
    making: graph.watch(appMaking(view.app.eid)),
  }
  let all = Object.values(watches)
  let draw = () =>
    drawCanvas(root, {
      apps: watches.apps.value,
      making: watches.making.value,
    })
  let off = all.map((w) => w.subscribe(draw))
  if (all.some((w) => w.value.length)) draw()
  let shows = (e: Event) => {
    let link = (e.target as Element).closest?.('[data-shows]') as
      | HTMLElement
      | null
    if (!link) return
    check(root, 'made', 'screens')
    // Open follows the screens on show (public/frames.js).
    let win =
      (root.ownerDocument.defaultView ?? globalThis) as typeof globalThis
    check(root, 'screen', link.dataset.shows)
      ?.dispatchEvent(new win.Event('change', { bubbles: true }))
  }
  root.addEventListener('click', shows)
  return () => {
    root.removeEventListener('click', shows)
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
      let { person } = JSON.parse(root.dataset.canvasView!) as CanvasRoot
      let stop = bindCanvas(
        root,
        pageGraph([sideWords, appCanvasWords], person),
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
