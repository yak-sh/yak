/**
 * A page's part in being kept (./worker.ts): it registers its site's worker,
 * and sends the worker a snapshot of itself as the person last saw it,
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
  document: Pick<Document, 'documentElement' | 'visibilityState'> & {
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

/** The snapshot of the page in `win` as it is now. */
export let snapshot = (win: Window): Snapshot => ({
  keep: win.location.href,
  html: '<!doctype html>' + win.document.documentElement.outerHTML,
  at: Date.now(),
  since: win.performance.timeOrigin,
})

/** Register `worker` for the page in `win`, and keep the page with it. */
export let keep = (win: Window, worker: string): void => {
  let workers = win.navigator.serviceWorker
  if (!workers || win.document.documentElement.hasAttribute(KEPT)) return
  workers.register(worker).catch((e) => win.reportError?.(e))
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
