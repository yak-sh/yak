/**
 * Where a page's person is: whether its tab is visible and has focus, said on
 * the page's socket when that changes and every `BEAT` while it is open, so
 * the server keeps their whereabouts (./whereabouts.ts) and lets a row fade
 * once the page is gone without a word. The page's half of whereabouts, which
 * @yaks/client and the yaks.app app pages' client both say through.
 *
 * ```ts ignore
 * import { browserPage, sayTab } from '@yaks/notify/tab'
 *
 * let page = browserPage()
 * if (page) sayTab(page, (tab) => socket.send(JSON.stringify({ tab })))
 * ```
 */

import { BEAT, type Tab } from './whereabouts.ts'

/** The page a client says its tab from: a browser's `window`, by default. */
export type Page = {
  document: {
    visibilityState: string
    hasFocus: () => boolean
    addEventListener: (type: string, fn: () => void) => void
    removeEventListener: (type: string, fn: () => void) => void
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

/** Say `page`'s tab to `say` now, on each change and every `BEAT`; the
 * returned function stops. */
export let sayTab = (page: Page, say: (tab: Tab) => void): () => void => {
  let { document } = page
  let now = () =>
    say({
      visible: document.visibilityState == 'visible',
      focused: document.hasFocus(),
    })
  document.addEventListener('visibilitychange', now)
  page.addEventListener('focus', now)
  page.addEventListener('blur', now)
  let beat = page.setInterval(now, BEAT)
  now()
  return () => {
    document.removeEventListener('visibilitychange', now)
    page.removeEventListener('focus', now)
    page.removeEventListener('blur', now)
    page.clearInterval(beat)
  }
}
