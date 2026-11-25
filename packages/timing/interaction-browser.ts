// The input and paint boundary shared by the platform's documents. Most
// controls need only their native input or DOM change. An asynchronous
// result takes its input with @yaks/ui/interaction before doing any work.
import {
  PRERENDER_KEY,
  PRERENDER_LINK,
  RESULT,
  type ResultEvent,
  whenUsable,
} from '@yaks/ui/interaction'
import {
  type Batch,
  MAX_MS,
  MAX_POINTS,
  phases,
  type Point,
} from './interaction.ts'

type Browser = Window & typeof globalThis
type Labels = {
  page: (url: URL) => string
  target: (el: Element, url: URL, event: string) => string
  send: (batch: Batch) => void
}
type Input = {
  event: Event
  at: Element
  began: number
  page: string
  target: string
  owned?: boolean
  scheduled?: boolean
  done?: boolean
  changed?: boolean
}
// `before` is the leaving document's time origin and `left` when it went.
type Crossing = Pick<Input, 'page' | 'target' | 'began'> & {
  before: number
  left: number
}
let CROSSING = 'yak-interaction-crossing'
let DELAY = 2_000
// Two documents' clocks can disagree by a little rounding.
let SLACK = 5
let LISTENING = Symbol.for('yaks.interactions')

let element = (e: Event): Element | undefined =>
  e.composedPath().find((node) => (node as Node).nodeType == 1) as
    | Element
    | undefined

// Modified clicks and links leaving this tab have no result in this document.
let ordinary = (e: MouseEvent) =>
  e.button == 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
let self = (at: string | null) => !at || at.toLowerCase() == '_self'

let native = (e: Event, at: Element, here: URL): URL | undefined => {
  let field = (e as SubmitEvent).submitter
  let link = e.type == 'click' && at.closest('a[href]')
  if (
    link && (link.hasAttribute('download') ||
      !self(link.getAttribute('target')))
  ) return
  if (
    e.type == 'submit' && !self(
      field?.getAttribute('formtarget') ?? at.getAttribute('target'),
    )
  ) return
  if (
    e.type == 'submit' &&
    (field?.getAttribute('formmethod') ?? at.getAttribute('method'))
        ?.toLowerCase() ==
      'dialog'
  ) return
  let href = link
    ? link.getAttribute('href')
    : e.type == 'submit'
    ? field?.getAttribute('formaction') ?? at.getAttribute('action') ??
      here.href
    : null
  if (href == null) return
  try {
    let to = new URL(href, here)
    if (to.origin == here.origin) return to
  } catch { /* the browser ignores an invalid destination too */ }
}

let sameDocument = (to: URL, here: URL) =>
  to.pathname == here.pathname && to.search == here.search &&
  (to.hash != here.hash || to.href.endsWith('#') || !!to.hash)

// requestAnimationFrame starts before layout and paint. A task queued from
// it reads the end of that rendering opportunity, without adding a frame.
let painted = (win: Browser, after: (end: number) => void) =>
  win.requestAnimationFrame(() =>
    win.setTimeout(() => after(win.performance.now()), 0)
  )

let local = (win: Browser, prerender = false) => {
  let place = () => {
    if (!prerender) return { store: win.sessionStorage, key: CROSSING }
    let key = win.sessionStorage.getItem(PRERENDER_KEY)
    return key ? { store: win.localStorage, key } : undefined
  }
  let read = (): Crossing | undefined => {
    try {
      let at = place()
      if (!at) return
      let held = at.store.getItem(at.key)
      at.store.removeItem(at.key)
      if (held) return JSON.parse(held)
    } catch { /* storage is optional */ }
  }
  let keep = (crossing: Crossing) => {
    try {
      let at = place()
      if (at) at.store.setItem(at.key, JSON.stringify(crossing))
    } catch { /* storage is optional */ }
  }
  return { read, keep }
}

let firstPaint = (win: Browser, finish: (end: number) => void) => {
  let fcp = (entries: PerformanceEntry[]) =>
    entries.find((e) => e.name == 'first-contentful-paint')?.startTime
  let seen = fcp(win.performance.getEntriesByType('paint'))
  if (seen != null) return finish(seen)
  if (win.PerformanceObserver?.supportedEntryTypes?.includes('paint')) {
    let paints = new win.PerformanceObserver((list) => {
      let end = fcp(list.getEntries())
      if (end == null) return
      paints.disconnect()
      finish(end)
    })
    paints.observe({ type: 'paint', buffered: true })
    return
  }
  if (win.document.readyState == 'loading') {
    win.document.addEventListener(
      'DOMContentLoaded',
      () => painted(win, finish),
      {
        once: true,
      },
    )
  } else painted(win, finish)
}

let crossed = (
  win: Browser,
  store: ReturnType<typeof local>,
  record: (point: Point) => void,
  restored = false,
) => {
  let perf = win.performance
  let nav = perf.getEntriesByType('navigation')[0] as
    | (PerformanceNavigationTiming & { activationStart?: number })
    | undefined
  let activation = nav?.activationStart
  let held = (activation && !restored ? local(win, true).read() : undefined) ??
    store.read()
  if (!held || Math.abs(perf.timeOrigin + perf.now() - held.began) > MAX_MS) {
    return
  }
  // Only the document whose navigation the leaving page started finishes its
  // input. One that started later (back from another site's sign-in page)
  // would count the time the person spent there.
  if (!restored && perf.timeOrigin > held.left + SLACK) return
  if (activation && !restored) {
    let began = held.began - perf.timeOrigin
    whenUsable(win, (usable) => {
      let ready = Math.max(began, activation, usable)
      let finish = (end: number) => {
        let ms = end - began
        if (ms < 0 || win.document.visibilityState == 'hidden') return
        perf.measure('yak-page', {
          start: Math.max(0, began),
          end,
          detail: {
            url: win.location.href,
            from: 'prerender',
            wait: 0,
            usable: ready - began,
            ...(began < 0 ? { elapsed: ms } : {}),
          },
        })
        record({
          page: held.page,
          target: held.target,
          ms,
          ...phases(ms, 0, 0, end - ready),
        })
      }
      firstPaint(win, (paint) => {
        if (paint >= ready) finish(paint)
        else painted(win, finish)
      })
    })
    return
  }
  let finish = (end: number) => {
    let ms = perf.timeOrigin + end - held.began
    if (ms < 0 || win.document.visibilityState == 'hidden') return
    // From the navigation's start: a form's post and its redirects are as
    // much the server's as the page they lead to.
    let server = nav && !restored ? nav.responseEnd : 0
    let ready = restored ? end : nav?.domInteractive || end
    record({
      page: held.page,
      target: held.target,
      ms,
      ...phases(ms, 0, server, end - ready),
    })
  }
  if (restored) painted(win, finish)
  else if (held.before != perf.timeOrigin && nav?.type != 'reload') {
    firstPaint(win, finish)
  }
}

/** Listen once on a document. Inputs without a visible result fall out of
 * the local frame, and an explicit completion cannot also report a pending
 * frame or a background refresh. */
export let interactions = (win: Browser, labels: Labels): void => {
  let { document: doc, performance: perf } = win
  if (Object.hasOwn(doc, LISTENING)) return
  Object.defineProperty(doc, LISTENING, { value: true })
  let points: Point[] = []
  let timer = 0
  let flush = () => {
    win.clearTimeout(timer)
    timer = 0
    if (!points.length) return
    let batch = {
      id: win.crypto.randomUUID(),
      at: Math.floor(perf.timeOrigin + perf.now()),
      points,
    }
    points = []
    labels.send(batch)
  }
  let record = (point: Point) => {
    if (point.ms > MAX_MS) return
    points.push(point)
    if (points.length == MAX_POINTS) flush()
    else if (!timer) timer = win.setTimeout(flush, DELAY)
  }

  let store = local(win)
  let prepared = local(win, true)
  let leaving = ({ page, target, began }: Input): Crossing => ({
    page,
    target,
    began: perf.timeOrigin + began,
    before: perf.timeOrigin,
    left: perf.timeOrigin + perf.now(),
  })
  let recent: Input | undefined
  let crossing: { input: Input; event?: Event } | undefined
  let events = new WeakMap<Event, Input>()
  let timings: PerformanceEventTiming[] = []
  let remember = (entries: PerformanceEntry[]) => {
    timings.push(...entries as PerformanceEventTiming[])
    if (timings.length > 64) timings.splice(0, timings.length - 64)
  }
  let observer: PerformanceObserver | undefined
  if (win.PerformanceObserver?.supportedEntryTypes?.includes('event')) {
    observer = new win.PerformanceObserver((list) =>
      remember(list.getEntries())
    )
    let options = { type: 'event', buffered: true, durationThreshold: 16 }
    observer.observe(options)
  }
  let timing = (input: Input) => {
    remember(observer?.takeRecords() ?? [])
    return timings.findLast((e) =>
      e.name == input.event.type && Math.abs(e.startTime - input.began) < 1
    )
  }
  let finish = (input: Input, end: number, ready?: number, server = 0) => {
    if (input.done || doc.visibilityState == 'hidden') return
    input.done = true
    let heard = timing(input)
    let began = heard?.startTime ?? input.began
    let ms = Math.max(0, end - began)
    record({
      page: input.page,
      target: input.target,
      ms,
      ...phases(
        ms,
        heard ? heard.processingStart - began : 0,
        server,
        end - (ready ?? heard?.processingEnd ?? end),
      ),
    })
  }
  let localFrame = (input = recent, check = () => true) => {
    if (!input || input.owned || input.scheduled || input.done) return
    input.scheduled = true
    let ready = perf.now()
    painted(win, (end) => {
      if (input.owned) return
      let pending = crossing?.input == input &&
        !crossing.event?.defaultPrevented
      if (!pending && check()) {
        finish(input, end, timing(input) ? undefined : ready)
      } else input.scheduled = false
    })
  }
  let changed = () => {
    if (!recent) return
    recent.changed = true
    localFrame(recent)
  }
  let changes = new win.MutationObserver(changed)
  let look = (input: Input) => {
    // Keep a change from a previous input even when both reach the same frame.
    if (changes.takeRecords().length) changed()
    recent = input
    changes.observe(doc.body ?? doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
    win.requestAnimationFrame(() => {
      if (recent != input) return
      if (changes.takeRecords().length) changed()
      changes.disconnect()
      recent = undefined
    })
  }
  let begin = (e: Event) => {
    if (!e.isTrusted || doc.visibilityState == 'hidden') return
    if (e.type == 'click' && !ordinary(e as MouseEvent)) return
    let at = element(e)
    if (!at) return
    let here = new URL(win.location.href)
    // Enter can issue a click as its default action and a submit then
    // follows that click. Carry the initiating clock through both.
    let sameKey = recent && !recent.owned && !recent.done &&
      (recent.event.type == 'keydown' || recent.event.type == 'keyup') &&
      e.type == 'click' && (e as MouseEvent).detail == 0 &&
      (recent.at.contains(at) || at.contains(recent.at))
    let button = (e as SubmitEvent).submitter
    let submits = e.type == 'submit' && recent && at.contains(recent.at)
    let prior = sameKey || submits ? recent : undefined
    let input = prior ?? {
      event: e,
      at,
      began: Math.min(perf.now(), e.timeStamp),
      page: labels.page(here),
      target: '',
    }
    input.target = labels.target(button ?? at, here, e.type)
    events.set(e, input)
    look(input)
    let to = native(e, at, here)
    if (to && e.type == 'click' && sameDocument(to, here)) {
      localFrame(input, () => !e.defaultPrevented || !!input.changed)
    } else if (to) {
      crossing = { input, event: e }
      if (
        e.type == 'click' &&
        at.closest('a[href]')?.hasAttribute(PRERENDER_LINK)
      ) prepared.keep(leaving(input))
    } else crossing = undefined
  }

  let capture = { capture: true, passive: true }
  for (let type of ['click', 'keydown', 'keyup', 'submit']) {
    win.addEventListener(type, begin, capture)
  }
  for (let type of ['input', 'change', 'focusin', 'scroll', 'toggle']) {
    win.addEventListener(type, (e) => {
      if (e.isTrusted) changed()
    }, capture)
  }
  doc.addEventListener(RESULT, (e) => {
    let { input: event, take } = (e as CustomEvent<ResultEvent>).detail
    let input = event ? events.get(event) : recent
    if (!input || input.done || input.owned) return
    input.owned = true
    take({
      drawn: (server) => {
        let ready = perf.now()
        painted(win, (end) => finish(input, end, ready, server))
      },
      leaving: () => crossing = { input },
      cancel: () => input.done = true,
    })
  })
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState == 'hidden') flush()
  })
  win.addEventListener('pagehide', () => {
    let next = crossing
    crossing = undefined
    if (next && !next.event?.defaultPrevented && !next.input.done) {
      store.keep(leaving(next.input))
    }
    flush()
  })
  win.addEventListener('pageshow', (e) => {
    if (e.persisted) crossed(win, store, record, true)
  })
  let cross = () => crossed(win, store, record)
  if ((doc as Document & { prerendering?: boolean }).prerendering) {
    doc.addEventListener('prerenderingchange', () => win.setTimeout(cross, 0), {
      once: true,
    })
  } else cross()
}
