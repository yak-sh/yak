// Updates' card actions on yaks.app (@yaks/inbox `bindActions`), taken in the
// tab's page graph (./page-graph.ts) on each page the navigator lays in, so a
// write still pending when the page changes lands all the same.
import { actionWords, bindActions } from '@yaks/inbox/actions-browser'
import { leaving, PAGE } from '@yaks/ui/navigate'
import { pageGraph } from './page-graph.ts'

let start = (doc: Document) => {
  let page = () => {
    for (
      let root of doc.querySelectorAll<HTMLElement>('[data-inbox-actions]')
    ) {
      bindActions(
        root,
        pageGraph(actionWords, root.dataset.inboxScope!),
        leaving(doc),
      )
    }
  }
  page()
  doc.addEventListener(PAGE, page)
}

if (typeof document != 'undefined') start(document)
