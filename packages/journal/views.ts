/**
 * What this package draws. Anywhere: a row of an entity's history (the
 * `history` tool, ./tools.ts) as one line, when · who · what it wrote —
 * `2 minutes ago · yak task new Buy the cake · task; doc: Buy the cake`. In the
 * browsing app: the History page, which the sidebar offers over the days'
 * measurements, loaded when first drawn (./page.ts).
 *
 * @module
 */
import type { View } from '@yaks/inspect'
import { parse } from '@yaks/query/core'
import { type Bundle, define, type H, type Registry } from '@yaks/render'
import type { Shown } from '@yaks/render/views'
// @ts-types="@yaks/ui/lucide"
import History from 'lucide/dist/esm/icons/rotate-ccw-clock.mjs'

type Tx = { seq?: number; at?: string; by?: string; via?: string }

let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
let AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
let LONG = 60

// A value a line has room for: a word, a number, a short text. Who and when
// lead the line already, so the entities and moments a write stamps are left
// to its page; a long text is its opening words.
let brief = (v: unknown): string | undefined => {
  if (typeof v == 'number' || typeof v == 'boolean') return String(v)
  if (typeof v != 'string' || !v.trim() || EID.test(v) || AT.test(v)) return
  let flat = v.replace(/\s+/g, ' ').trim()
  return flat.length > LONG ? `${flat.slice(0, LONG - 1)}…` : flat
}

// What a row wrote, a component apiece: its name, then what it set that a
// line has room for — `doc: Buy the cake`, `removed claim`, `deleted`.
let wrote = (b: Bundle): string =>
  b.$delete ? 'deleted' : Object.entries(b)
    .filter(([c]) => c != 'entity' && c != '_tx' && !c.startsWith('$'))
    .map(([c, v]) => {
      if (v == null) return `removed ${c}`
      let said = Object.values(v as Record<string, unknown>)
        .flatMap((p) => brief(p) ?? [])
      return said.length ? `${c}: ${said.join(', ')}` : c
    })
    .join('; ')

// One row of a history: when, who, and what it wrote.
let change = <Node>(b: Bundle, h: H<Node>, s: Shown<Node>): Node => {
  let tx = b._tx as Tx
  let parts = [
    tx.at && h('time', { datetime: tx.at }, s.when(tx.at)),
    tx.by &&
    s.show(s.get?.(tx.by) ?? { entity: { eid: tx.by } }, 'Reference.Inline'),
    wrote(b),
  ].filter((p): p is Node => !!p)
  return h(
    'span',
    { class: 'Change' },
    ...parts.flatMap((p, i) => i ? [' · ', p] : [p]),
  )
}

let line = {
  match: parse('._tx'),
  needs: (b: Bundle) => [(b._tx as Tx).by].filter((e): e is string => !!e),
  render: <Node>(b: Bundle, h: H<Node>, ctx: unknown): Node =>
    change(b, h, ctx as Shown<Node>),
}

/** A history row as one line, in a list or alone. */
export let views: Registry = define([
  { view: 'Tile', ...line },
  { view: 'Page', ...line },
])

/** The page, loaded when first drawn. */
export let inspectViews = (): Promise<View[]> =>
  import('./page.ts').then((m) => m.inspectViews)

/** The page the sidebar offers: what history keeps, over the days. */
export let destinations = [
  {
    key: 'history',
    name: 'History',
    icon: 'history',
    query: '.kept * .order=-kept.day',
    view: 'History.Page',
  },
]

/** The glyph it wears there. */
export let icons = { history: History }
