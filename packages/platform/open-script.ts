// The picture and its replacement share this state across document.open().
// The small inline observer starts before either one's first frame.
let PUSH_OPEN = '_yak_open'

export let pushAddress = (address: string): string => {
  let url = new URL(address)
  url.searchParams.set(PUSH_OPEN, 'push')
  return url.href
}

export let plainAddress = (address: string): string => {
  let url = new URL(address)
  if (url.searchParams.get(PUSH_OPEN) != 'push') return address
  url.searchParams.delete(PUSH_OPEN)
  return url.href
}

let OPENING = `(endpoint, source) => {
  if (top != self) return
  let key = Symbol.for('yaks.open')
  let held = window[key]
  if (!held) {
    let url = new URL(location.href)
    let pushed = url.searchParams.get('${PUSH_OPEN}') == 'push'
    if (pushed) {
      url.searchParams.delete('${PUSH_OPEN}')
      history.replaceState(history.state, '', url.href)
    }
    let checked = navigator.webdriver ||
      new URLSearchParams(location.search).get('utm_source') == 'agent-check'
    let nav = performance.getEntriesByType('navigation')[0]
    let picture = !!source
    let ua = navigator.userAgent
    let short = Math.min(screen.width, screen.height)
    let long = Math.max(screen.width, screen.height)
    let device = /iPhone/.test(ua) && short == 375 && long == 812 ? 'iphone-compact'
      : /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'tablet'
      : /Mobile|iPhone|Android/i.test(ua) ? 'phone' : 'desktop'
    let open = {
      source: pushed ? 'push' : source || 'cold', picture, device,
      installed: !!navigator.standalone ||
        matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches,
      paint: null, usable: null,
      server: picture || !nav || !nav.responseStart ? null : nav.responseStart - nav.requestStart,
      estimated: false,
      controlled: self.origin !== 'null' && !!navigator.serviceWorker?.controller,
      navigation: picture || !nav ? undefined : {
        workerStart: nav.workerStart,
        fetchStart: nav.fetchStart,
        requestStart: nav.requestStart,
        responseStart: nav.responseStart,
      },
    }
    let id = !checked && crypto.randomUUID?.()
    let at = Math.floor(performance.timeOrigin)
    let sent = false
    let ready = false
    let replaced = Infinity
    let observer
    let saw = () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime
    let send = (leaving = false) => {
      if (sent || (!leaving && (!ready || open.paint == null))) return
      sent = true
      observer?.disconnect()
      // Paint Timing can publish after the frame callback. Its timestamp
      // still belongs to the picture if the fresh document was not in yet.
      let exact = saw()
      if (exact != null && exact <= replaced) {
        open.paint = exact
        open.estimated = false
        if (picture) {
          performance.clearMarks('yak-picture-paint')
          performance.mark('yak-picture-paint', { startTime: exact })
        }
      }
      if (open.usable != null) open.usable = Math.max(open.usable, open.paint ?? 0)
      if (!id) return
      let body = JSON.stringify({ id, at, points: [], open })
      if (!navigator.sendBeacon?.(endpoint, body)) {
        void fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => {})
      }
    }
    let paint = (ms, estimated) => {
      if (open.paint != null) return
      observer?.disconnect()
      open.paint = ms
      open.estimated = estimated
      if (picture) performance.mark('yak-picture-paint', { startTime: ms })
      send()
    }
    let first = saw()
    if (first != null) paint(first, false)
    else if (window.PerformanceObserver?.supportedEntryTypes?.includes('paint')) {
      observer = new PerformanceObserver((list) => {
        let seen = list.getEntriesByName('first-contentful-paint')[0]
        if (seen) paint(seen.startTime, false)
      })
      observer.observe({ type: 'paint', buffered: true })
    }
    let parsed = (run) => {
      if (document.readyState == 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true })
      } else run()
    }
    let frame = new Promise((done) => parsed(() =>
      requestAnimationFrame(() => setTimeout(() => {
        // Timing never holds what waits on the frame (@yaks/web/picture).
        try {
          let seen = saw()
          if (seen != null || !observer || picture) paint(seen ?? performance.now(), seen == null)
        } finally {
          done()
        }
      }, 0))))
    held = {
      frame,
      swapping: () => replaced = performance.now(),
      waited: (ms) => {
        open.server = ms
        performance.mark('yak-open-server', { detail: ms })
      },
      ready: () => parsed(() => {
        let mark = performance.getEntriesByName('yak-usable')[0]
        if (!mark && document.querySelector('[data-operator-opening], script[data-operator-chat]:not([hidden] *)')) return
        open.usable = mark?.startTime ?? performance.now()
        if (!mark) performance.mark('yak-usable')
        ready = true
        send()
      }),
      offline: () => {
        ready = true
        send()
      },
      leave: () => send(true),
    }
    window[key] = held
  }
  addEventListener('pagehide', held.leave, { once: true })
  if (!source) held.ready()
  return held
}`

/** Script installed by a platform page or a picture that stands in for it. */
export let openScript = (
  endpoint?: string,
  source?: 'picture' | 'shell' | 'push',
): string =>
  `(${OPENING})(${
    endpoint
      ? JSON.stringify(endpoint)
      : 'document.currentScript.dataset.yakOpen'
  },${JSON.stringify(source ?? null)})`
