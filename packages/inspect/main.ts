/**
 * The inspector's page in a browser, bundled by ./routes.ts and loaded at
 * `/inspect`. Its host is the smallest that works: the vocabulary the server
 * serves (@yaks/api `/vocab`), a @yaks/client box connected to that server,
 * the page's own graph for the inspector's state, the index's field
 * (@yaks/filter), each value's `Edit` and the stack of pages (@yaks/ux), and
 * the views, in the index and the stack beside it (./Frame.ts). A value is
 * changed through @yaks/ux, handed the same host at the root, its pickers
 * asking @yaks/api's `/query` for their candidates. Nothing else is on the
 * page.
 *
 * The address is the stack (./where.ts): a link inside the inspector, or a
 * row pressed, stacks its page in place, and the address follows the stack
 * as the page's graph holds it, a step of history each, so back, forward
 * and a shared link restore it. The keys step through a table's rows: ↓ or j
 * rests on the next row of the table the keys are in (the top page's first
 * table, before any), ↑ or k the one before, and Enter opens the row.
 *
 * @module
 */

import { signal } from '@preact/signals'
import { h, render } from 'preact'
import { client } from '@yaks/client'
import { desk, docs as draftDocs, drafts } from '@yaks/draft'
import { mint } from '@yaks/graph'
import { filters } from '@yaks/filter'
import { docs as fieldDocs } from '@yaks/filter/vocab'
import { Float, Panes } from '@yaks/ui'
import { panesOf, Ux } from '@yaks/ux'
import { docs as uxDocs } from '@yaks/ux/vocab'
import { loadVocab } from '@yaks/vocab'
import { inspector } from './door.ts'
import { frame } from './Frame.ts'
import { docs as own } from './front.ts'
import { live } from './live.ts'
import { editing, STACK } from './state.ts'
import { HOME, queryPath, stackOf, stackPath } from './where.ts'
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
let front = client(
  loadVocab([...fieldDocs, ...uxDocs, ...draftDocs, ...own]),
  [drafts()],
  { vault: false, wireVault: false },
)
// What is typed here waits in the page's own graph: the inspector keeps no
// draft past the page.
let typer = mint()
let typed = desk(front, { by: () => typer })

// The field's candidates show under it, above the index.
let fields = filters(front, { vocab, drafts: typed })

let host = live({ box, front, edits: true })

// The stack is the page's graph's; the address says it, a step of history
// for each change, and a step back or forward puts the one it says back.
let said = () => stackOf(location.href) ?? [HOME]
let restore = () =>
  void front.mutate([{ entity: { eid: STACK }, Stack: { panes: said() } }])
restore()
addEventListener('popstate', restore)
front.watch('.Stack').subscribe((rows) => {
  let panes = panesOf(rows.find((b) => b.entity.eid == STACK))
  if (panes.length && panes.join('\n') != said().join('\n')) {
    history.pushState(null, '', stackPath(panes))
  }
})

// The entities a line answers, asked of the server: a picker's candidates.
let find = async (line: string, limit: number, signal?: AbortSignal) => {
  let q = encodeURIComponent(`${line}&.limit=${limit}`)
  let r = await fetch(`/query?q=${q}`, { signal })
  if (!r.ok) throw new Error(await r.text())
  return await r.json()
}
let ux = editing(host, { find, fields, drafts: typed, Float })
let door = inspector(views, host)
let Frame = frame(door, {
  fields,
  Bar: ({ id }) =>
    h(fields.Filter, {
      id,
      placeholder: 'find, or a query: .task&.tally=filed.priority',
      onKey: (e: KeyboardEvent) => {
        if (e.key != 'Enter') return
        e.preventDefault()
        host.go(queryPath(fields.text(id).trim()))
      },
    }),
  Scroll: ({ children }) => h(Panes.Body, {}, children),
})

// A plain click on a link to another inspector address stacks it in place.
document.addEventListener('click', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
  let a = (ev.target as Element | null)?.closest?.('a[href]')
  let href = a?.getAttribute('href') ?? ''
  if (!href.startsWith('/') || !stackOf(href)) return
  ev.preventDefault()
  host.go(href)
})

// Where the keys are the page's: not while something takes what is typed.
let typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || /^(input|textarea|select)$/i.test(el.localName))

// The rows the keys step through: the table of the row they rest on, or the
// top page's first table.
let near = (): { rows: HTMLElement[]; on: number } => {
  let top = document.querySelector('.Stack_Pane')
  let at = document.activeElement
  let on = at instanceof HTMLElement && top?.contains(at) && at.dataset.pick
    ? at
    : undefined
  let table = on?.closest('.Table') ??
    top?.querySelector('.Table:has(.Table_Row[data-pick])')
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
    next.focus()
  } else if (ev.key == 'Enter' && on >= 0) {
    ev.preventDefault()
    host.go(host.link(rows[on].dataset.pick!))
  }
})

render(h(Ux, { host: ux }, h(Frame, null)), document.body)
