// Updates' card actions on yaks.app (@yaks/inbox `bindActions`), taken in the
// tab's page graph (./page-graph.ts) on each page the navigator lays in, so a
// write still pending when the page changes lands all the same; and the
// sidebar drawn from the same graph (./side-browser.ts).
import { actionWords, bindActions } from '@yaks/inbox/actions-browser'
import { leaving, PAGE } from '@yaks/ui/navigate'
import { pageGraph } from './page-graph.ts'
import { waitingWords } from './update-waiting.ts'
import { sideWords } from './side-rows.ts'
import { bindSide } from './side-browser.ts'

const BOUND = Symbol.for('@yaks/platform/updates-browser')

let start = (doc: Document & { [BOUND]?: boolean }) => {
  if (doc[BOUND]) return
  doc[BOUND] = true
  bindSide(doc, (person) => pageGraph([waitingWords, sideWords], person))
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
