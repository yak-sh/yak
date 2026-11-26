import { PAGE } from '@yaks/ui/navigate'

let MARK = 'data-app-mark-image'
let READY = 'data-app-mark-ready'

let ready = (image: HTMLImageElement) =>
  image.toggleAttribute(
    READY,
    image.complete && image.naturalWidth > 0 && image.currentSrc == image.src,
  )

/** Hide an image's backdrop once its current source can be shown. A swap or
 * a redraw (@yaks/ui/navigate `morph`) can keep the node and its pixels while
 * taking the mark away, as the server never drew it: it is put back while the
 * image can still be shown. */
export let imageFallbacks = (doc: Document): void => {
  let scan = () =>
    doc.querySelectorAll<HTMLImageElement>(`img[${MARK}]`).forEach(ready)
  let loaded = (event: Event) => {
    let image = event.target as HTMLImageElement | null
    if (image?.tagName == 'IMG' && image.hasAttribute(MARK)) ready(image)
  }
  doc.addEventListener('load', loaded, true)
  doc.addEventListener('error', loaded, true)
  doc.addEventListener(PAGE, scan)
  let Observer = doc.defaultView?.MutationObserver ??
    globalThis.MutationObserver
  new Observer((changes) => {
    for (let { target } of changes) {
      let image = target as HTMLImageElement
      if (image.hasAttribute(MARK) && !image.hasAttribute(READY)) ready(image)
    }
  }).observe(doc.documentElement, { subtree: true, attributeFilter: [READY] })
  scan()
}

if (typeof document != 'undefined') imageFallbacks(document)
