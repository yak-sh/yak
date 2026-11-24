/**
 * The navigator on a browser's page (@yaks/ui/navigate): loaded by a script
 * marked `data-navigate`, it follows the links of the page's site in place,
 * with the browser's own history.
 *
 * Each click is written to the browser's performance timeline as a
 * `yak-page` measure, from the click to the frame that draws the new page,
 * its detail where the time went (`Swapped`). `yak admin browse` reads them
 * back, which is how a slow click is seen as a number.
 *
 * @module
 */
import { PAGE, start, type Swapped } from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

if (typeof document != 'undefined') {
  start(globalThis.window, browserHistory())
  document.addEventListener(PAGE, (e) => {
    let { began, phases, url, tally } = (e as CustomEvent<Swapped>).detail
    let swapped = performance.now()
    requestAnimationFrame(() => {
      let end = performance.now()
      let frame = end - swapped
      performance.measure('yak-page', {
        start: began,
        end,
        detail: { url, ...phases, frame, made: tally.made },
      })
    })
  })
}
