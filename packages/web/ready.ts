import { READY, start } from '@yaks/ui/navigate'
import { browserHistory } from './history.ts'

/** Keep the page a link opens ready when it needs its own document scripts. */
export let ready = (link: HTMLAnchorElement, to: string): void => {
  let win = globalThis.window
  let doc = win.document
  link.href = to
  link.setAttribute(READY, '')
  start(
    {
      document: doc,
      location: win.location,
      fetch: win.fetch.bind(win),
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
