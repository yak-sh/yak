/**
 * An Operator page's views shown in place (./talk-views.ts): a press on the
 * side's link to another view of the page, or Back to one, is drawn by
 * showing it (@yaks/ui/navigate `DRAW`), with nothing fetched. Showing a
 * view hides the others, names the page and says what its bar says under
 * the name, lights the side's link to it,
 * stands the aside and the frame's parts that are its own (`PART`) beside it
 * or not, marks the frame as it, points the page's back fields at it, and
 * puts back where it was scrolled: at its foot where it was left at its
 * foot, as a conversation never shown opens at its newest line. The bar's
 * title it wore comes back with it, as it was drawn. Each view shown or
 * hidden hears `VIEWED`.
 *
 * Every view keeps running while hidden, save the conversation's watch,
 * which says the tab is on its Operator (./operator-talk-browser.ts); one
 * whose script stood hidden since the page came starts when first shown (a
 * script that started says so with `STARTED`). Updates shown this way are
 * read, as opening their page reads them: each space's are marked through
 * the tab's page graph (@yaks/inbox `seen`), after the frame that shows them.
 *
 * @module
 */
import { DRAW, type Drawing, rerun } from '@yaks/ui/navigate'
import { actionWords } from '@yaks/inbox/actions-browser'
import type { UpdatesView } from './updates-view.ts'
import { pageGraph } from './page-graph.ts'
import { SIDE } from './side-browser.ts'
import { canvasAt, canvases, chooseCanvas } from './app-canvas-browser.ts'
import { type CanvasSlot, SLOT } from './app-canvas-view.ts'
import { PART, type TalkView, VIEW, viewAt, VIEWED } from './talk-views.ts'

let ON = 'SideNav_Link-on'

/** The mark a view's script sets on itself once it started. */
export let STARTED = 'data-started'

let said = (el: Element) => JSON.parse(el.getAttribute(VIEW)!) as TalkView

// The bar's title each view wore as it was hidden, as drawn (a helper's
// wears how it stands), and the title it said then.
let worn = new WeakMap<Element, { nodes: Node[]; title: string }>()

// The bar titled for `next`, after `was`: as it was left, where its title is
// the same since, else in words.
let title = (bar: Element, was: Element | undefined, next: Element) => {
  if (was) worn.set(was, { nodes: [...bar.childNodes], title: said(was).title })
  let { title } = said(next), kept = worn.get(next)
  if (kept?.title == title) bar.replaceChildren(...kept.nodes)
  else bar.textContent = title
}

// The side lit for `view`: its link the page's, and every space's Updates
// lit where it is that, which the side's redraw reads (./side-browser.ts).
let light = (doc: Document, view: TalkView) => {
  for (let a of doc.querySelectorAll('.SideNav_Link[href]')) {
    if (a.getAttribute('href') == view.link) {
      a.classList.add(ON)
      a.setAttribute('aria-current', 'page')
    } else if (a.getAttribute('aria-current') == 'page') {
      a.classList.remove(ON)
      a.removeAttribute('aria-current')
    }
  }
  let side = doc.querySelector<HTMLElement>(SIDE)
  let drawn = side && JSON.parse(side.dataset.sideView!)
  if (drawn?.talk) {
    drawn.talk.all = view.all
    side!.dataset.sideView = JSON.stringify(drawn)
  }
}

// Each space's Updates in `view` read, as opening their page reads them.
let read = (view: Element) => {
  for (let root of view.querySelectorAll<HTMLElement>('[data-updates-view]')) {
    let { person, spaces } = JSON.parse(
      root.dataset.updatesView!,
    ) as UpdatesView
    let graph = pageGraph(actionWords, person)
    for (let { eid } of spaces) {
      Promise.resolve(graph.mutate([{
        entity: { eid: crypto.randomUUID() },
        inboxAction: { kind: 'seen', space: eid, target: eid, answer: '' },
      }])).catch((e: unknown) => globalThis.reportError?.(e))
    }
  }
}

/** Show `next` of the page's `views` in `doc`, the others hidden. The
 * page's layout is read once, before anything changes, and laid out once,
 * by putting the scroll back after every other change: a read or a write
 * between two changes lays the whole page out again, which is most of a
 * press's time on a long conversation. */
export let show = (
  doc: Document,
  views: HTMLElement[],
  next: HTMLElement,
): void => {
  let view = said(next)
  let body = doc.getElementById('content')
  let was = views.find((v) => !v.hidden)
  // Where the view left was scrolled: its foot, where it was at its end,
  // so what came while it stood hidden is in sight when it shows again.
  if (body && was) {
    let end = body.scrollTop + body.clientHeight >= body.scrollHeight - 2
    was.dataset.scroll = end ? 'end' : String(body.scrollTop)
  }
  let frame = doc.querySelector('.Frame')
  if (frame) {
    if (was) frame.classList.remove(...said(was).marks)
    frame.classList.add(...view.marks)
  }
  for (let part of doc.querySelectorAll<HTMLElement>(`[${PART}]`)) {
    part.hidden = part.getAttribute(PART) != view.here
  }
  for (let v of views) {
    if (v.hidden == (v != next)) continue
    v.hidden = v != next
    v.dispatchEvent(new (doc.defaultView ?? globalThis).Event(VIEWED))
  }
  for (let s of next.querySelectorAll(`script:not([src]):not([${STARTED}])`)) {
    if (s.getAttribute('type') == 'module') rerun(s)
  }
  doc.title = view.page
  let bar = doc.querySelector('[data-title]')
  if (bar) title(bar, was, next)
  let sub = doc.querySelector('.Frame_Sub')
  if (sub && view.sub) sub.textContent = view.sub
  let skip = doc.querySelector('a.Skip')
  if (skip) {
    skip.setAttribute('href', view.skip[0])
    skip.textContent = view.skip[1]
  }
  for (
    let at of doc.querySelectorAll<HTMLElement>('#aside, .Frame_AsideTools')
  ) {
    at.hidden = !view.aside
  }
  for (
    let back of doc.querySelectorAll<HTMLInputElement>(
      'form[data-side] input[name=back]',
    )
  ) back.value = view.here
  light(doc, view)
  if (body) {
    let kept = next.dataset.scroll ??
      (next.querySelector('[data-conversation]') ? 'end' : '0')
    body.scrollTop = kept == 'end' ? body.scrollHeight : Number(kept)
  }
  // Marking them read is no part of what the press shows: it is written
  // once the frame showing them is drawn.
  let win = doc.defaultView
  if (win?.requestAnimationFrame) {
    win.requestAnimationFrame(() => win.setTimeout(() => read(next)))
  } else read(next)
}

/** Draw the views of each page in `doc` in place when a press or Back
 * leads to one. */
export let switching = (doc: Document, bind = canvases(doc)): void => {
  doc.addEventListener(DRAW, (e) => {
    let asked = (e as CustomEvent<Drawing>).detail
    let to = new URL(asked.to)
    let here = to.pathname + to.search
    let app = to.searchParams.has('app') ? canvasAt(doc, here) : undefined
    if (to.searchParams.has('app') && !app) return
    if (app) to.searchParams.delete('app')
    let views = [...doc.querySelectorAll<HTMLElement>(`[${VIEW}]`)]
    let at = viewAt(
      views.map((el) => ({ here: said(el).here, el })),
      to.pathname + to.search,
    )
    let slot = doc.querySelector<HTMLElement>(`[${SLOT}]`)
    let chat = slot && JSON.parse(slot.dataset.canvasSlot!) as CanvasSlot
    let sameChat = chat && chat.here == to.pathname + to.search
    if (app ? !sameChat : !at && !sameChat) return
    asked.focusAfterPaint = !!sameChat && (!!app || !at?.el.hidden)
    asked.draw = () => {
      if (at?.el.hidden) show(doc, views, at.el)
      if (slot) chooseCanvas(doc, slot, here, app, bind)
    }
  })
}

if (typeof document != 'undefined') switching(document)
