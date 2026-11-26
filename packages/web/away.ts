/**
 * Leaving the page's site in a new tab, for the anchors a page writes by hand.
 * Markdown and the kit's parts draw a link that leaves with its target
 * already (@yaks/markdown/away); this module listens once on the document, so
 * any other link, a page's own or one a script draws later, opens the same
 * way when it is pressed. A page shell loads it as a module, and @yaks/web's
 * page imports it.
 *
 * The page's site is its location's host, the host this script came from
 * and the one its tag names in `data-home`: the platform whose page it is. A
 * link from a platform page on a space's host to yaks.app stays in the tab,
 * and one from yaks.app to a space's site leaves. A link that
 * names its own target, or a download, is left as it says.
 *
 * A form that sends itself to a new tab (a connection's sign-in at its
 * broker) leaves this page as it was before the sign-in finished there, so
 * the page is read again when the person comes back to it.
 *
 * @module
 */
import { leaves, type Site } from '@yaks/markdown/away'

/** What the script listens on, as a browser window gives it. */
export type Away = {
  document: Pick<Document, 'addEventListener' | 'visibilityState'>
  location: Pick<Location, 'hostname' | 'reload'>
  sessionStorage?: Pick<Storage, 'setItem'>
  addEventListener: (type: string, fn: (e: Event) => void) => void
}

/** Open each link off `site` in a new tab as it is pressed, and read the
 * page again when a form sent to a new tab is come back from. */
export let away = (win: Away, site: Site): void => {
  win.addEventListener('click', (e) => {
    if (e.defaultPrevented) return
    let link = (e.target as Element | null)?.closest?.('a[href]')
    if (!link || link.hasAttribute('target') || link.hasAttribute('download')) {
      return
    }
    if (!leaves(link.getAttribute('href'), site)) return
    link.setAttribute('target', '_blank')
    let rel = (link.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean)
    if (!rel.includes('noopener')) rel.push('noopener')
    link.setAttribute('rel', rel.join(' '))
  })

  let gone = false
  win.addEventListener('submit', (e) => {
    let sent = e as SubmitEvent
    let target = sent.submitter?.getAttribute('formtarget') ??
      (sent.target as Element | null)?.getAttribute?.('target')
    if (target == '_blank') gone = true
  })
  win.document.addEventListener('visibilitychange', () => {
    if (!gone || win.document.visibilityState != 'visible') return
    try {
      // Why it reloads, for the reloaded page's telemetry
      // (@yaks/platform/interaction-browser `reloaded`).
      win.sessionStorage?.setItem('yak-reload', 'away')
    } catch { /* counted without its cause */ }
    win.location.reload()
  })
}

if (typeof document != 'undefined' && typeof location != 'undefined') {
  let home = document.querySelector<HTMLElement>('script[data-home]')
  away(globalThis.window, [
    location.hostname,
    new URL(import.meta.url).hostname,
    ...home?.dataset.home ? [home.dataset.home] : [],
  ])
}
