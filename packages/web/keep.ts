/**
 * A page's part in being kept (./worker.ts): it registers its site's worker
 * once it has loaded. It sends a snapshot when the loaded page is first
 * controlled, and again when it is hidden, left in place (`yak-leave`), or
 * unloaded. A page with parts of its own (`OWN`) sends its shell beside it:
 * the same document with those parts empty. The fresh page that replaces
 * a picture sends its own snapshot.
 *
 * @module
 */
import { KEPT, OWN, SCROLL } from './picture.ts'
import { LEAVE, PAGE } from '@yaks/ui/navigate'
import type { Snapshot } from './worker.ts'

/** What `keep` needs of the window around the page. */
export type Window = {
  document:
    & Pick<Document, 'documentElement' | 'visibilityState' | 'readyState'>
    & {
      scrollingElement?: Element | null
      addEventListener(type: string, hear: () => void): void
    }
  location: { href: string }
  navigator: {
    serviceWorker?: Pick<
      ServiceWorkerContainer,
      'register' | 'controller' | 'addEventListener'
    >
  }
  performance: { timeOrigin: number }
  addEventListener(type: string, hear: () => void): void
  reportError?: (error: unknown) => void
}

// What a page holds that nobody sees: a picture of it would only be slower
// to draw, and its scripts never run in one (./picture.ts).
let UNSEEN = 'script, template, [hidden], dialog:not([open])'

let scroll = (pane: Element) =>
  pane.scrollTop > 0 &&
    pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 2
    ? 'end'
    : String(Math.max(0, pane.scrollTop || 0))

/** The snapshot of the page in `win` as it shows now, without what is not
 * shown, and its shell where it has parts of its own. */
export let snapshot = (win: Window): Snapshot => {
  let { documentElement: root, scrollingElement: page } = win.document
  let shown = root.cloneNode(true) as Element
  if (page?.scrollTop) shown.setAttribute(SCROLL, scroll(page))
  let panes = root.querySelectorAll(`[${SCROLL}]`)
  for (let [i, copy] of [...shown.querySelectorAll(`[${SCROLL}]`)].entries()) {
    copy.setAttribute(SCROLL, scroll(panes[i]))
  }
  for (let e of shown.querySelectorAll(UNSEEN)) e.remove()
  let doc = (e: Element) => '<!doctype html>' + e.outerHTML
  let shell = shown.querySelector(`[${OWN}]`) &&
    shown.cloneNode(true) as Element
  for (let own of shell ? shell.querySelectorAll(`[${OWN}]`) : []) {
    own.replaceChildren()
  }
  return {
    keep: win.location.href,
    html: doc(shown),
    ...shell ? { shell: doc(shell) } : {},
    at: Date.now(),
    since: win.performance.timeOrigin,
  }
}

/** Register `worker` for the page in `win`, and keep the page with it.
 * A page matching `pending` is still opening. Keep it after the navigator
 * delivers its contents. */
export let keep = (win: Window, worker: string, pending?: string): void => {
  let workers = win.navigator.serviceWorker
  if (!workers || win.document.documentElement.hasAttribute(KEPT)) return
  let loaded = false, seeded = false
  let send = () => {
    let root = win.document.documentElement
    if (
      !workers.controller || root.hasAttribute(KEPT) ||
      pending && root.querySelector(pending)
    ) return
    workers.controller.postMessage(snapshot(win))
    seeded = true
  }
  let seed = () => {
    if (loaded && !seeded) send()
  }
  // Keep the loaded page even if the browser later discards it without
  // running a leave handler. Start registration after the page's own files.
  let start = () => {
    loaded = true
    if (workers.controller) seed()
    else workers.addEventListener('controllerchange', seed, { once: true })
    workers.register(worker).catch((e) => win.reportError?.(e))
  }
  if (win.document.readyState == 'complete') start()
  else win.addEventListener('load', start)
  win.document.addEventListener(PAGE, seed)
  // Taken and sent at once: a page being hidden may not run again.
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState == 'hidden') send()
  })
  win.document.addEventListener(LEAVE, send)
  win.addEventListener('pagehide', send)
}
