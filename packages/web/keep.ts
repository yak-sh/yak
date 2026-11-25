/**
 * A page's part in being kept (./worker.ts): it registers its site's worker
 * once it has loaded, and sends the worker a snapshot of itself as the person last saw it,
 * whenever it is hidden, left for another page in place (`yak-leave`), or
 * unloaded. A picture already (./picture.ts) sends none: the page it becomes
 * sends its own.
 *
 * @module
 */
import { KEPT } from './picture.ts'
import { LEAVE } from '@yaks/ui/navigate'
import type { Snapshot } from './worker.ts'

/** What `keep` needs of the window around the page. */
export type Window = {
  document:
    & Pick<Document, 'documentElement' | 'visibilityState' | 'readyState'>
    & {
      addEventListener(type: string, hear: () => void): void
    }
  location: { href: string }
  navigator: {
    serviceWorker?: Pick<ServiceWorkerContainer, 'register' | 'controller'>
  }
  performance: { timeOrigin: number }
  addEventListener(type: string, hear: () => void): void
  reportError?: (error: unknown) => void
}

// What a page holds that nobody sees: a picture of it would only be slower
// to draw, and its scripts never run in one (./picture.ts).
let UNSEEN = 'script, template, [hidden], dialog:not([open])'

/** The snapshot of the page in `win` as it shows now, without what is not
 * shown. */
export let snapshot = (win: Window): Snapshot => {
  let shown = win.document.documentElement.cloneNode(true) as Element
  for (let e of shown.querySelectorAll(UNSEEN)) e.remove()
  return {
    keep: win.location.href,
    html: '<!doctype html>' + shown.outerHTML,
    at: Date.now(),
    since: win.performance.timeOrigin,
  }
}

/** Register `worker` for the page in `win`, and keep the page with it. */
export let keep = (win: Window, worker: string): void => {
  let workers = win.navigator.serviceWorker
  if (!workers || win.document.documentElement.hasAttribute(KEPT)) return
  // Once the page has loaded: a worker starting meanwhile would hold up the
  // files it is still asking for.
  let register = () =>
    workers.register(worker).catch((e) => win.reportError?.(e))
  if (win.document.readyState == 'complete') register()
  else win.addEventListener('load', register)
  // Taken and sent at once: a page being hidden may not run again.
  let send = () => {
    if (win.document.documentElement.hasAttribute(KEPT)) return
    workers.controller?.postMessage(snapshot(win))
  }
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState == 'hidden') send()
  })
  win.document.addEventListener(LEAVE, send)
  win.addEventListener('pagehide', send)
}
