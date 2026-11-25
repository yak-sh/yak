/**
 * The navigator on a browser's page (@yaks/ui/navigate): loaded by a script
 * marked `data-navigate`, it follows the links of the page's site in place,
 * with the browser's own history.
 *
 * Each click is written to the browser's performance timeline as a
 * `yak-page` measure, from the click to the frame that draws the new page,
 * its detail where the page came from and where the time went (`Swapped`);
 * a held page asked for again and laid over is one more, from `fresh`, and
 * a press the page drew in place is one too, from `drawn` (`SHOWN`). A
 * click on a page not held is a `yak-press` too: to the frame it shows
 * itself in, before its page comes. Each page it asks for is a `yak-fetch`
 * mark. `yak admin browse` reads them
 * back, which is how a slow click is seen as a number.
 *
 * @module
 */
import {
  AHEAD,
  type Browsing,
  GOING,
  PAGE,
  SHOWN,
  start,
  type Swapped,
} from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

const NAVIGATOR = Symbol.for('yaks.navigator')

/** The navigator shared by the views of a browser document. */
export let navigation = (
  win: Window & typeof globalThis,
  follows?: Browsing['follows'],
): ReturnType<typeof start> => {
  let held = win as Window & { [NAVIGATOR]?: ReturnType<typeof start> }
  if (held[NAVIGATOR]) return held[NAVIGATOR]
  let { document, location, DOMParser, performance } = win
  // Each page it asks for is a `yak-fetch` mark, whether ahead or not, so
  // what its looking ahead costs is counted apart from a page's own fetches.
  let fetch: typeof win.fetch = (url, init) => {
    let ahead = new Headers(init?.headers).has(AHEAD)
    if (init?.method != 'HEAD') {
      performance.mark('yak-fetch', { detail: { url: String(url), ahead } })
    }
    return win.fetch(url, init)
  }
  let go = start(
    {
      document,
      location,
      fetch,
      addEventListener: win.addEventListener.bind(win),
      scrollTo: win.scrollTo.bind(win),
      requestIdleCallback: win.requestIdleCallback?.bind(win),
      DOMParser,
      follows,
    },
    browserHistory(win),
  )
  let measure = (e: Event) => {
    let { began, phases, from, url, tally } = (e as CustomEvent<Swapped>)
      .detail
    let swapped = performance.now()
    win.requestAnimationFrame(() => {
      let end = performance.now()
      let frame = end - swapped
      performance.measure('yak-page', {
        start: began,
        end,
        detail: { url, from, ...phases, frame, made: tally.made },
      })
    })
  }
  document.addEventListener(PAGE, measure)
  document.addEventListener(SHOWN, measure)
  // A click on a page not held: the frame it shows itself in at once.
  document.addEventListener(GOING, (e) => {
    let { began } = (e as CustomEvent<{ began: number }>).detail
    win.requestAnimationFrame(() =>
      performance.measure('yak-press', {
        start: began,
        end: performance.now(),
        detail: { url: location.href },
      })
    )
  })
  return held[NAVIGATOR] = go
}

if (
  typeof document != 'undefined' &&
  document.querySelector('script[data-navigate]')
) {
  navigation(globalThis.window)
}
