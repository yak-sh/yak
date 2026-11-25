import { result } from '@yaks/ui/interaction'
import { READY, start } from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

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
      enter: (html, drawn) => {
        doc.open()
        if (drawn) {
          doc.addEventListener('DOMContentLoaded', drawn, { once: true })
        }
        doc.write(html)
        doc.close()
      },
    },
    browserHistory(win),
  )
  return (input) => go(new URL(address), false, result(doc, input))
}
