import { interactions } from '@yaks/timing/interaction-browser'
import { type Batch, phases, type Point } from '@yaks/timing/interaction'
import { CHECK } from './bots.ts'
import { pageKind, reloadTarget, targetKind } from './interaction.ts'

type Browser = Window & typeof globalThis

/**
 * The point a reloaded document is counted as, once it first paints: its
 * page, why it reloaded (`reloadTarget`, from the cause the reloading script
 * stamped), and how long the person looked at nothing in between, from the
 * reload to the new page's first paint. Null for a document that was not
 * reloaded. The stamp is taken either way, so a stale one counts nothing.
 */
export let reloaded = (win: Browser, page: string): Promise<Point | null> => {
  let cause: string | null = null
  try {
    cause = win.sessionStorage.getItem('yak-reload')
    win.sessionStorage.removeItem('yak-reload')
  } catch { /* a sandboxed page is counted without its cause */ }
  let nav = win.performance.getEntriesByType?.('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined
  if (nav?.type != 'reload' || !win.PerformanceObserver) {
    return Promise.resolve(null)
  }
  return new Promise((done) => {
    let observer = new win.PerformanceObserver((list) => {
      let paint = list.getEntriesByName('first-contentful-paint')[0]
      if (!paint) return
      observer.disconnect()
      let ms = paint.startTime
      let server = Math.min(ms, nav.responseStart)
      done({
        page,
        target: reloadTarget(cause),
        ms,
        ...phases(ms, 0, server, ms - server),
      })
    })
    observer.observe({ type: 'paint', buffered: true })
  })
}

let view = typeof document == 'undefined' ? null : document.defaultView
if (view && view.top == view) {
  let endpoint = document.querySelector('[data-yak-interaction]')
    ?.getAttribute('data-yak-interaction')
  let test = () =>
    navigator.webdriver ||
    new URLSearchParams(location.search).get('utm_source') == CHECK
  let checked = test()
  let send = (batch: Batch) => {
    if (!endpoint || checked || test()) return
    let body = JSON.stringify(batch)
    if (navigator.sendBeacon?.(endpoint, body)) return
    void fetch(endpoint, {
      method: 'POST',
      body,
      keepalive: true,
    }).catch(() => {/* telemetry can be lost when the document closes */})
  }
  let here = new URL(location.href)
  void reloaded(view, pageKind(here.pathname, here.searchParams.has('app')))
    .then((point) =>
      point &&
      send({
        id: crypto.randomUUID(),
        at: Math.floor(performance.timeOrigin + performance.now()),
        points: [point],
      })
    )
  interactions(view, {
    page: (url) => pageKind(url.pathname, url.searchParams.has('app')),
    target: targetKind,
    send,
  })
}
