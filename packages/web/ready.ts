import { READY, start } from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

/** Keep the page a link opens ready when it needs its own document scripts. */
export let ready = (
  link: HTMLAnchorElement,
  to: string,
  first?: Promise<Response | null>,
): void => {
  let win = globalThis.window
  let doc = win.document
  link.href = to
  link.setAttribute(READY, '')
  let address = link.href
  start(
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
      enter: (html) => {
        doc.open()
        doc.write(html)
        doc.close()
      },
    },
    browserHistory(win),
  )
}
