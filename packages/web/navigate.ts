/**
 * The navigator on a browser's page (@yaks/ui/navigate): loaded by a script
 * marked `data-navigate`, it follows the links of the page's site in place,
 * with the browser's own history.
 *
 * Each click is written to the browser's performance timeline as a
 * `yak-page` measure, from the click to the frame that draws the new page,
 * its detail where the page came from and where the time went (`Swapped`);
 * a held page asked for again and laid over is one more, from `fresh`. A
 * click on a page not held is a `yak-press` too: to the frame it shows
 * itself in, before its page comes. `yak admin browse` reads them
 * back, which is how a slow click is seen as a number.
 *
 * @module
 */
import { GOING, PAGE, start, type Swapped } from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

if (typeof document != 'undefined') {
  start(globalThis.window, browserHistory())
  document.addEventListener(PAGE, (e) => {
    let { began, phases, from, url, tally } = (e as CustomEvent<Swapped>)
      .detail
    let swapped = performance.now()
    requestAnimationFrame(() => {
      let end = performance.now()
      let frame = end - swapped
      performance.measure('yak-page', {
        start: began,
        end,
        detail: { url, from, ...phases, frame, made: tally.made },
      })
    })
  })
  // A click on a page not held: the frame it shows itself in at once.
  document.addEventListener(GOING, (e) => {
    let { began } = (e as CustomEvent<{ began: number }>).detail
    requestAnimationFrame(() =>
      performance.measure('yak-press', {
        start: began,
        end: performance.now(),
        detail: { url: location.href },
      })
    )
  })
}
