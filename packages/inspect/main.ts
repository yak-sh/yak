/**
 * The inspector's page in a browser, bundled by ./routes.ts and loaded at
 * `/inspect`. Its host is the smallest that works: the vocabulary the server
 * serves (@yaks/api `/vocab`), a @yaks/client box connected to that server,
 * the page's own graph for the inspector's state and its query field
 * (@yaks/filter), and the views (./live.ts `live`, `here`). Nothing else is on
 * the page.
 *
 * The address is the page's state: a link inside the inspector is followed in
 * place, and back and forward walk what was followed.
 *
 * @module
 */

import { signal } from '@preact/signals'
import { h, render } from 'preact'
import { client } from '@yaks/client'
import { filters, type Float } from '@yaks/filter'
import { docs as fieldDocs } from '@yaks/filter/vocab'
import { loadVocab } from '@yaks/vocab'
import { inspector } from './door.ts'
import { docs as own } from './front.ts'
import { here, live } from './live.ts'
import { at, mapPath } from './where.ts'
import { views } from './views.ts'

let { docs, keywords } = await (await fetch('/vocab')).json()
let vocab = loadVocab(docs, keywords)
let box = client(vocab, [], {
  url: location.origin,
  signal,
  vault: false,
  wireVault: false,
  // A refused query says why where it was asked (./live.ts); anything else
  // that goes wrong on the way is the console's.
  report: (t) => t.refused || console.warn('@yaks/inspect', t.error, t.sent),
})
let front = client(loadVocab([...fieldDocs, ...own]), [], {
  vault: false,
  wireVault: false,
})

// The list of candidates floats under the field it completes.
let Below: Float = ({ children }) =>
  h('div', { class: 'InspectPage_Float' }, children)
let fields = filters(front, { vocab, Float: Below })

let where = signal(at(location.href) ?? {})
let go = (href: string) => {
  history.pushState(null, '', href)
  where.value = at(href) ?? {}
}
addEventListener('popstate', () => where.value = at(location.href) ?? {})

let host = live({
  box,
  front,
  edits: true,
  Bar: ({ id, run }) =>
    h(fields.Filter, {
      id,
      placeholder: 'a query: ._comp, .task&.tally=filed.priority…',
      onKey: (e: KeyboardEvent) => {
        if (e.key != 'Enter') return
        e.preventDefault()
        let line = fields.text(id)
        run(line)
        go(mapPath(line.trim()))
      },
    }),
})
let Here = here(host, inspector(views, host), fields.set)

// A plain click on a link to another inspector address follows it in place.
document.addEventListener('click', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
  let a = (ev.target as Element | null)?.closest?.('a[href]')
  let href = a?.getAttribute('href') ?? ''
  if (!href.startsWith('/') || !at(href)) return
  ev.preventDefault()
  go(href)
})

let Page = () =>
  h('main', { class: 'InspectPage' }, h(Here, { where: where.value }))

render(h(Page, null), document.body)
