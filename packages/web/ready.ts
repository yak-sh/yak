import {
  PRERENDER_KEY,
  PRERENDER_LINK,
  result,
  USABLE,
  whenUsable,
} from '@yaks/ui/interaction'
import { type Entering, READY, start } from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

let FILES = 'link[rel=stylesheet], link[rel=modulepreload], script[src]'

// Start the held page's stylesheets and scripts without installing them in
// the current page. The destination declares its own module dependencies.
let prepare = (doc: Document) => {
  let links = new Map<string, HTMLLinkElement>()
  return (page: Document, at: URL) => {
    let used = new Set<string>()
    for (let file of page.querySelectorAll(FILES)) {
      let href = new URL(
        file.getAttribute('href') ?? file.getAttribute('src')!,
        at,
      )
      if (href.origin != at.origin) continue
      let as = file.getAttribute('rel') == 'stylesheet' ? 'style' : 'script'
      let module = file.getAttribute('rel') == 'modulepreload' ||
        file.getAttribute('type') == 'module'
      let cors = file.getAttribute('crossorigin') ?? (module ? '' : null)
      let key = JSON.stringify([href.href, as, cors])
      used.add(key)
      if (links.has(key)) continue
      let link = doc.createElement('link')
      link.rel = 'preload'
      link.as = as
      link.href = href.href
      if (cors != null) link.crossOrigin = cors
      doc.head.append(link)
      links.set(key, link)
    }
    for (let [key, link] of links) {
      if (used.has(key)) continue
      link.remove()
      links.delete(key)
    }
  }
}

// The markup can paint before its controls are bound. Time the frame after
// the destination says it is usable, using the clock of the original click.
let finished = (win: Window & typeof globalThis, opening: Entering) => {
  let { performance } = win
  whenUsable(win, (usable) => {
    opening.drawn?.()
    win.requestAnimationFrame(() =>
      win.setTimeout(() => {
        let { url, from, began, wait } = opening
        performance.measure('yak-page', {
          start: began,
          end: performance.now(),
          detail: { url, from, wait, usable: usable - began },
        })
      }, 0)
    )
  })
}

/** Ask the browser to prepare a running document for this same-tab link. */
export let prerender = (
  link: HTMLAnchorElement,
  to: string,
): (input: Event) => void => {
  let doc = link.ownerDocument
  let win = doc.defaultView!
  link.href = to
  link.setAttribute(READY, '')
  link.setAttribute(PRERENDER_LINK, '')
  try {
    // The browser copies this key to the document it prepares. The click
    // itself comes later and is written under that key in shared storage.
    let key = PRERENDER_KEY + ':' + win.crypto.randomUUID()
    let was = win.sessionStorage.getItem(PRERENDER_KEY)
    if (was) win.localStorage.removeItem(was)
    win.sessionStorage.setItem(PRERENDER_KEY, key)
  } catch { /* private browsing can leave timing unavailable */ }
  let rule = doc.createElement('script')
  rule.type = 'speculationrules'
  rule.textContent = JSON.stringify({
    prerender: [{ source: 'list', urls: [link.href] }],
  })
  doc.head.append(rule)
  return (input) => {
    result(doc, input)?.leaving()
    win.location.assign(link.href)
  }
}

/** Keep a link's document ready. Return an opener for a press received
 * before the navigator attached. */
export let ready = (
  link: HTMLAnchorElement,
  to: string,
  first?: Promise<Response | null>,
): (input: Event) => Promise<void> => {
  let win = globalThis.window
  let doc = win.document
  link.href = to
  link.setAttribute(READY, '')
  let address = link.href
  let go = start(
    {
      document: doc,
      location: win.location,
      fetch: async (url, init) => {
        if (!first || url != address) return win.fetch(url, init)
        let asked = first
        first = undefined
        return await asked ?? Response.error()
      },
      addEventListener: win.addEventListener.bind(win),
      scrollTo: win.scrollTo.bind(win),
      requestIdleCallback: win.requestIdleCallback?.bind(win),
      DOMParser,
      prepare: prepare(doc),
      enter: (html, opening) => {
        win.performance.clearMarks(USABLE)
        doc.open()
        finished(win, opening)
        doc.write(html)
        doc.close()
      },
    },
    browserHistory(win),
  )
  return (input) =>
    go(
      new URL(address),
      false,
      result(doc, input),
      Math.min(win.performance.now(), input.timeStamp),
    )
}
