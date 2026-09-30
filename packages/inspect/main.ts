/**
 * The inspector's page in a browser, bundled by ./routes.ts and loaded at
 * `/inspect`. Its host is the smallest that works: the vocabulary the server
 * serves (@yaks/api `/vocab`), a @yaks/client box connected to that server,
 * the page's own graph for the inspector's state and the index's field
 * (@yaks/filter), and the views, in the three panes (./Frame.ts). Nothing
 * else is on the page.
 *
 * The address is the page shown: a link inside the inspector is followed in
 * place, and back and forward walk what was followed. The keys step through
 * a table's rows: ↓ or j picks the next row of the table a row was last
 * picked in (the first table, before any), ↑ or k the one before, and Enter
 * opens the picked row's own page.
 *
 * @module
 */

import { signal } from '@preact/signals'
import { h, render } from 'preact'
import { client } from '@yaks/client'
import { filters } from '@yaks/filter'
import { docs as fieldDocs } from '@yaks/filter/vocab'
import { Panes } from '@yaks/ui'
import { loadVocab } from '@yaks/vocab'
import { inspector } from './door.ts'
import { frame } from './Frame.ts'
import { docs as own } from './front.ts'
import { live } from './live.ts'
import { at, queryPath } from './where.ts'
import { views } from './views.ts'

let { docs, keywords } = await (await fetch('/vocab')).json()
let vocab = loadVocab(docs, keywords)
let box = client(vocab, [], {
  url: location.origin,
  signal,
  vault: false,
  wireVault: false,
  // Who wrote a row, and when, is the server's to say.
  provenance: () => null,
  // A refused query says why where it was asked (./live.ts); anything else
  // that goes wrong on the way is the console's.
  report: (t) => t.refused || console.warn('@yaks/inspect', t.error, t.sent),
})
let front = client(loadVocab([...fieldDocs, ...own]), [], {
  vault: false,
  wireVault: false,
})

// The field's candidates show under it, above the index.
let fields = filters(front, { vocab })

let where = signal(at(location.href) ?? {})
let go = (href: string) => {
  if (href == location.pathname + location.search) return
  history.pushState(null, '', href)
  where.value = at(href) ?? {}
}
addEventListener('popstate', () => where.value = at(location.href) ?? {})

let host = live({ box, front, edits: true })
let door = inspector(views, host)
let Frame = frame(door, {
  Bar: ({ id }) =>
    h(fields.Filter, {
      id,
      placeholder: 'find, or a query: .task&.tally=filed.priority',
      onKey: (e: KeyboardEvent) => {
        if (e.key != 'Enter') return
        e.preventDefault()
        go(queryPath(fields.text(id).trim()))
      },
    }),
  Scroll: ({ children }) => h(Panes.Body, {}, children),
})

// A plain click on a link to another inspector address follows it in place.
document.addEventListener('click', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
  let a = (ev.target as Element | null)?.closest?.('a[href]')
  let href = a?.getAttribute('href') ?? ''
  if (!href.startsWith('/') || !at(href)) return
  ev.preventDefault()
  go(href)
})

// Where the keys are the page's: not while something takes what is typed.
let typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || /^(input|textarea|select)$/i.test(el.localName))

// The rows the keys step through: the picked row's table's, or the page's
// first table's.
let near = (): { rows: HTMLElement[]; on: number } => {
  let page = document.querySelector('[data-pane=page]')
  let on = page?.querySelector<HTMLElement>('.Table_Row-on[data-pick]')
  let table = on?.closest('.Table') ??
    page?.querySelector('.Table:has(.Table_Row[data-pick])')
  let rows = [
    ...table?.querySelectorAll<HTMLElement>('.Table_Row[data-pick]') ?? [],
  ]
  return { rows, on: on ? rows.indexOf(on) : -1 }
}

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey || typing(ev.target)) return
  let d = ev.key == 'ArrowDown' || ev.key == 'j'
    ? 1
    : ev.key == 'ArrowUp' || ev.key == 'k'
    ? -1
    : 0
  let { rows, on } = near()
  if (d) {
    let next = rows[Math.max(0, Math.min(rows.length - 1, on + d))]
    if (!next) return
    ev.preventDefault()
    host.pick(next.dataset.pick!)
    next.scrollIntoView({ block: 'nearest' })
  } else if (ev.key == 'Enter' && on >= 0) {
    ev.preventDefault()
    go(host.link(rows[on].dataset.pick!))
  }
})

let Page = () => h(Frame, { where: where.value })

render(h(Page, null), document.body)
