/**
 * Where a page's person is: whether its tab is visible, focused, and has
 * recent input. The page's half of whereabouts, which
 * @yaks/client and the yaks.app app pages' client both say through.
 *
 * ```ts ignore
 * import { browserPage, sayTab } from '@yaks/notify/tab'
 *
 * let page = browserPage()
 * if (page) sayTab(page, (tab) => socket.send(JSON.stringify({ tab })))
 * ```
 */

import { type Clock, system } from '@yaks/fp'
import { BEAT, type Tab } from './whereabouts.ts'

/** How long input counts toward a tab's presence. */
export let IDLE = 5 * 60_000

let INPUT = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchmove',
  'input',
]

/** The page a client says its tab from: a browser's `window`, by default. */
export type Page = {
  document: {
    visibilityState: string
    hasFocus: () => boolean
    addEventListener: (type: string, fn: () => void, capture?: boolean) => void
    removeEventListener: (
      type: string,
      fn: () => void,
      capture?: boolean,
    ) => void
  }
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
}

/** The browser's page, none on any other runtime. */
export let browserPage = (): Page | undefined => {
  let g = globalThis as unknown as Partial<Page>
  return typeof g.document?.hasFocus == 'function' && g.addEventListener
    ? g as Page
    : undefined
}

/** Say the tab's changes and renew the legacy whereabouts timestamp every
 * `BEAT`. The returned function stops both. */
export let sayTab = (
  page: Page,
  say: (tab: Tab) => void,
  clock: Clock = system,
): () => void => {
  let { document } = page
  let last = -Infinity
  let stopIdle: (() => void) | undefined
  let left = () => last + IDLE - clock.now()
  let report = () =>
    say({
      visible: document.visibilityState == 'visible',
      focused: document.hasFocus(),
      idle: left() <= 0,
    })
  let expire = () => {
    let remaining = left()
    stopIdle = remaining > 0 ? clock.after(remaining, expire) : undefined
    if (!stopIdle) report()
  }
  let input = () => {
    let idle = left() <= 0
    last = clock.now()
    stopIdle ??= clock.after(IDLE, expire)
    if (idle) report()
  }
  document.addEventListener('visibilitychange', report)
  page.addEventListener('focus', report)
  page.addEventListener('blur', report)
  for (let event of INPUT) document.addEventListener(event, input, true)
  let beat = page.setInterval(report, BEAT)
  report()
  return () => {
    document.removeEventListener('visibilitychange', report)
    page.removeEventListener('focus', report)
    page.removeEventListener('blur', report)
    for (let event of INPUT) document.removeEventListener(event, input, true)
    page.clearInterval(beat)
    stopIdle?.()
  }
}
