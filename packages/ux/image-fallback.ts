import { PAGE } from '@yaks/ui/navigate'

let MARK = 'data-app-mark-image'
let READY = 'data-app-mark-ready'

let ready = (image: HTMLImageElement) =>
  image.toggleAttribute(
    READY,
    image.complete && image.naturalWidth > 0 && image.currentSrc == image.src,
  )

/** Hide an image's backdrop once its current source can be shown. A swap
 * can keep the node and its pixels while restoring the server's attributes. */
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
  scan()
}

if (typeof document != 'undefined') imageFallbacks(document)
