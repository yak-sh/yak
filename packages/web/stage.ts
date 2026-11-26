/** Markup that follows the opening document, or replaces a marker in it. */
export type Stage = {
  marker?: string
  contents: Promise<string>
}

/** Send the opening markup while the rest is being drawn. A cancelled
 * navigation leaves no writer waiting on the browser. */
export let staged = (
  open: string,
  close: string,
  later?: Stage,
): string | ReadableStream<Uint8Array> => {
  if (!later) return open + close
  if (later.marker) {
    let at = open.indexOf(later.marker)
    if (at >= 0) {
      close = open.slice(at + later.marker.length) + close
      open = open.slice(0, at)
    }
  }
  let bytes = new TextEncoder()
  let end = later.contents.then((html) => html + close, () => close)
  return new ReadableStream<Uint8Array>({
    async start(body) {
      body.enqueue(bytes.encode(open))
      let last = await end
      try {
        body.enqueue(bytes.encode(last))
        body.close()
      } catch {
        // The reader cancelled before the rest arrived.
      }
    },
  })
}
