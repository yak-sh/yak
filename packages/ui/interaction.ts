/** A visible result that arrives after the event's own frame. Works across
 * independently bundled page scripts through the document's event channel. */
export let RESULT = 'yak-interaction-result'
export let USABLE = 'yak-usable'

/** Run once the page's own controls are ready. */
export let whenUsable = (
  win: Window & typeof globalThis,
  use: (at: number) => void,
): void => {
  let mark = win.performance.getEntriesByName(USABLE)[0]
  if (mark) return use(mark.startTime)
  let observer = new win.PerformanceObserver((list) => {
    let mark = list.getEntriesByName(USABLE)[0]
    if (!mark) return
    observer.disconnect()
    win.clearTimeout(stop)
    use(mark.startTime)
  })
  let stop = win.setTimeout(() => observer.disconnect(), 10_000)
  observer.observe({ entryTypes: ['mark'] })
}

export type Result = {
  /** Milliseconds spent waiting for a response, exclusive of drawing it. */
  drawn: (server?: number) => void
  /** The result will be drawn by the next document. */
  leaving: () => void
  /** A newer action took its place, or there will be no visible result. */
  cancel: () => void
}

export type ResultEvent = {
  input?: Event
  take: (result: Result) => void
}

/** Take responsibility for marking the result of an input, before awaiting
 * anything. With no observer, the page carries on without a measurement. */
export let result = (doc: Document, input?: Event): Result | undefined => {
  let view = doc.defaultView
  if (!view) return
  let held: Result | undefined
  doc.dispatchEvent(
    new view.CustomEvent<ResultEvent>(RESULT, {
      detail: { input, take: (next) => held = next },
    }),
  )
  return held
}
