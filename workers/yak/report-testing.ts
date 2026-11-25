// Run a page's woven script in a top-level browser realm. The error fixtures
// supply the document and events. There is no rendered frame in this realm.
export let runReporter = (
  code: string,
  page: string,
  scope: { fetch: unknown },
  bindings: Record<string, unknown> & {
    sendBeacon: (url: string, body: Blob) => boolean
  },
): void => {
  let location = new URL(page)
  let win = Object.assign(scope, { origin: location.origin })
  let { sendBeacon, ...events } = bindings
  let globals = {
    ...events,
    location,
    window: win,
    self: win,
    top: win,
    globalThis: win,
    navigator: { userAgent: '', webdriver: true, sendBeacon },
    fetch: win.fetch,
    matchMedia: () => ({ matches: false }),
    screen: { width: 1280, height: 800 },
    performance: {
      timeOrigin: 0,
      now: () => 0,
      getEntriesByName: () => [],
      getEntriesByType: () => [],
      mark: () => {},
    },
    requestAnimationFrame: () => 0,
  }
  new Function(...Object.keys(globals), code)(...Object.values(globals))
}
