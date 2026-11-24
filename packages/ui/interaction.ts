/** A visible result that arrives after the event's own frame. Works across
 * independently bundled page scripts through the document's event channel. */
export let RESULT = 'yak-interaction-result'

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
