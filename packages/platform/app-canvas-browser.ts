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
import {
  appCanvas,
  appQuestion,
  CANVAS_CHANGED,
  canvasAttrs,
  type CanvasChoice,
  type CanvasRoot,
  type CanvasSlot,
  showing,
  VIEW,
} from './app-canvas-view.ts'
import { besideMark, type SideView } from './side-parts.ts'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

let OPENING = 'data-canvas-opening'

let element = (doc: Document, node: ReturnType<typeof appCanvas>) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content.firstElementChild as HTMLElement
}

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
  let opening = root.hasAttribute(OPENING)
  let app = appsOf(held.apps, view.space).find((a) => a.eid == view.app.eid)
  if (opening) app ??= view.app
  if (!app) return
  let next: CanvasRoot = { ...view, app }
  let drawn = element(
    root.ownerDocument,
    appCanvas(next, makingOf(held.making, app.eid), canvasAttrs(next)),
  )
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
  if (root.hasAttribute(OPENING) || all.some((w) => w.value.length)) draw()
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

/** Keep a new canvas graph-bound after its opening frame has painted. */
export let canvases = (doc: Document) => {
  let bound = new WeakMap<Element, () => void>()
  let bind = (root: HTMLElement) => {
    if (bound.has(root)) return
    let signal = leaving(doc)
    let win = doc.defaultView
    let stop: (() => void) | undefined
    let close = () => {
      bound.delete(root)
      signal.removeEventListener('abort', close)
      stop?.()
    }
    bound.set(root, close)
    signal.addEventListener('abort', close, { once: true })
    let watch = () => {
      if (!bound.has(root) || !root.isConnected) return
      let { person } = JSON.parse(root.dataset.canvasView!) as CanvasRoot
      stop = bindCanvas(root, pageGraph([sideWords, appCanvasWords], person))
    }
    if (win?.requestAnimationFrame) {
      win.requestAnimationFrame(() => win.setTimeout(watch))
    } else watch()
  }
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) bind(root)
  }
  each()
  doc.addEventListener(PAGE, each)
  return (old: HTMLElement | null, root?: HTMLElement) => {
    if (old) bound.get(old)?.()
    if (root) bind(root)
  }
}

/** The app a sidebar link would open, where the page already holds its row. */
export let canvasAt = (doc: Document, here: string) => {
  let link = [...doc.querySelectorAll<HTMLElement>('[data-side-app]')]
    .find((a) => a.getAttribute('href') == here)
  return link && {
    link,
    app: JSON.parse(link.dataset.sideApp!) as CanvasRoot['app'],
  }
}

let introduce = (doc: Document, operator: string, app?: CanvasRoot['app']) => {
  let hello = doc.querySelector<HTMLElement>('[data-canvas-greeting]')
  if (!hello) return
  let [title, words] = JSON.parse(hello.dataset.canvasGreeting!) as string[]
  hello.querySelector('h2')!.textContent = app ? appQuestion(app) : title
  hello.querySelector('p')!.textContent = app
    ? `Tell ${operator}, and watch it change beside this chat.`
    : words
  let slot = doc.querySelector<HTMLTemplateElement>('[data-talk-starts]')
  if (!slot) return
  let starts = slot.nextElementSibling
  if (app && starts?.matches('.Talk_Starts')) slot.content.append(starts)
  else if (!app) slot.after(slot.content)
}

/** Show just the app's shell on the opening frame. The conversation stays
 * mounted, and the stage and its frames fill in from the page graph. */
export let chooseCanvas = (
  doc: Document,
  slot: HTMLElement,
  at: string,
  choice: ReturnType<typeof canvasAt>,
  bind: ReturnType<typeof canvases>,
) => {
  let old = doc.querySelector<HTMLElement>(VIEW)
  let app = choice?.app
  if (old?.dataset.app == app?.slug) return
  let { here, ...scope } = JSON.parse(slot.dataset.canvasSlot!) as CanvasSlot
  let frame = slot.parentElement!
  let side = frame.querySelector<HTMLElement>('[data-side-view]')
  if (side?.dataset.sideView) {
    let view = JSON.parse(side.dataset.sideView) as SideView
    if (view.talk) {
      view.talk.app = app?.slug
      side.dataset.sideView = JSON.stringify(view)
    }
  }
  let previous = side?.querySelector('[data-side-app][aria-current="true"]')
  previous?.removeAttribute('aria-current')
  previous?.querySelector('[data-side-open]')?.remove()
  let tool = frame.querySelector('.Talk_Show')
  tool?.remove()
  old?.remove()
  frame.classList.toggle('Talk-app', !!app)
  let root: HTMLElement | undefined
  if (choice) {
    let view: CanvasRoot = { ...scope, app: choice.app }
    root = element(
      doc,
      appCanvas(view, undefined, { ...canvasAttrs(view), [OPENING]: '' }, true),
    )
    slot.before(root)
    let bar = frame.querySelector('.Frame_Bar')
    bar?.insertBefore(
      element(doc, showing(choice.app)),
      bar.querySelector('.Frame_AsideTools'),
    )
    choice.link.setAttribute('aria-current', 'true')
    choice.link.append(element(doc, besideMark()))
  }
  bind(old, root)
  introduce(doc, scope.operator, app)
  let back = doc.querySelector<HTMLInputElement>('.Talk_Keep [name=return]')
  if (back) back.value = app ? at : here
  for (
    let input of doc.querySelectorAll<HTMLInputElement>(
      'form[data-side] input[name=back]',
    )
  ) {
    input.value = at
  }
  let win = doc.defaultView ?? globalThis
  doc.dispatchEvent(
    new win.CustomEvent<CanvasChoice>(CANVAS_CHANGED, {
      detail: { here: app ? at : here, app },
    }),
  )
}
