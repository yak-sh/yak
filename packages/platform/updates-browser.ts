// Updates' card actions on yaks.app (@yaks/inbox `bindActions`), taken in the
// tab's page graph (./page-graph.ts) on each page the navigator lays in, so a
// write still pending when the page changes lands all the same.
import { actionWords, bindActions } from '@yaks/inbox/actions-browser'
import { leaving, PAGE } from '@yaks/ui/navigate'
import { pageGraph } from './page-graph.ts'
import type { Bundle } from '@yaks/graph'
import type { Client, Watch } from '@yaks/client'
import {
  UPDATE_WAITING,
  waitingCounts,
  waitingWords,
} from './update-waiting.ts'

let BADGES = '[data-update-badges]'
const BOUND = Symbol.for('@yaks/platform/updates-browser')

let paint = (root: HTMLElement, rows: Bundle[]) => {
  let counts = waitingCounts(rows)
  let total = [...counts.values()].reduce((sum, n) => sum + n, 0)
  for (let badge of root.querySelectorAll<HTMLElement>('[data-across]')) {
    let slug = badge.dataset.across
    let count = slug ? counts.get(slug) ?? 0 : total
    badge.textContent = count ? String(count) : ''
    badge.hidden = !count
  }
}

/** Keep the sidebar badges on the tab's page graph as its pages change. */
export let bindBadges = (
  doc: Document,
  graph: (person: string) => Pick<Client, 'watch'>,
): () => void => {
  let person: string | undefined, watch: Watch | undefined
  let draw = () => {
    let root = doc.querySelector<HTMLElement>(BADGES)
    if (root && root.dataset.updateBadges == person && watch?.ready) {
      paint(root, watch.value)
    }
  }
  let page = () => {
    let next = doc.querySelector<HTMLElement>(BADGES)?.dataset.updateBadges
    if (next != person) {
      watch?.close()
      person = next
      watch = person ? graph(person).watch(UPDATE_WAITING) : undefined
      watch?.subscribe(draw)
    }
    draw()
  }
  page()
  doc.addEventListener(PAGE, page)
  return () => {
    doc.removeEventListener(PAGE, page)
    watch?.close()
  }
}

let start = (doc: Document & { [BOUND]?: boolean }) => {
  if (doc[BOUND]) return
  doc[BOUND] = true
  bindBadges(doc, (person) => pageGraph([waitingWords], person))
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
