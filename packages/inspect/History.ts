/**
 * A history, newest first, off the journal (@yaks/journal): each transaction
 * a moment on a timeline, when and by whom and through which session, and
 * under it what each change made of a component, property by property: what
 * it was before and what it became.
 *
 * An entity's history is the changes aimed at it; a transaction's is
 * everything it wrote; a property's page shows the recent writes of its
 * component that touched it. Wherever the changes are not all about one
 * entity, each says which it was about.
 *
 * The changes are asked a page at a time (`_change` rows, by one column),
 * and beside them, once they are in, the transactions that made them, the
 * components they wrote and the people and sessions who wrote them, each by
 * its eid. What a property was before is the value the next older change on
 * the page gave it; the oldest change on a page says only what it wrote.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { Timeline, Value } from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { paged, Paging } from './grid.ts'
import { chip } from './schema.ts'
import { about, Part, useNamed } from './notes.ts'
import { comp, named, str, unique } from './read.ts'
import { none, rows, waiting } from './rows.ts'
import { key } from './state.ts'
import { mention, reads } from './value.ts'

/** How many changes a page of history holds. */
export let CHANGES = 40

type Row = Record<string, unknown>

// A change's value: the component as it was written, or null where it went.
let value = (b: Bundle) => comp(b, '_change').value as Row | null | undefined

// One property's change: what it was, and what it became, each as a person
// reads it (a reference by name, a moment in words, a hash cut short).
let moved = (
  io: Io,
  name: string,
  prop: string,
  was: unknown,
  now: unknown,
  known: boolean,
) => {
  let p = io.vocab.prop(name, prop)
  return h(
    'span',
    { key: prop },
    h(Value, { mod: 'id' }, prop),
    ' ',
    known ? [reads(io, was, p), ' → '] : null,
    reads(io, now, p),
  )
}

/**
 * What one change did to the component `name`, property by property, given
 * the change before it (the next older one of the same component on the same
 * entity) where the page holds it: each property that moved, or every one it
 * wrote a value to when what came before is not known; only `prop`, where one
 * is named.
 */
let did = (
  io: Io,
  name: string,
  b: Bundle,
  older?: Bundle,
  prop?: string,
): ComponentChildren[] => {
  let now = value(b)
  if (now == null) return ['removed']
  let was = older ? value(older) ?? {} : undefined
  let props = Object.keys(now).filter((p) =>
    (!prop || p == prop) &&
    (was ? JSON.stringify(was[p]) != JSON.stringify(now[p]) : now[p] != null)
  )
  return props.length
    ? props.map((p) => moved(io, name, p, was?.[p], now[p], !!was))
    : ['wrote what it held']
}

// Every entity the values of these changes name, so each reads by name.
let mentioned = (all: Bundle[]): string[] =>
  all.flatMap((b) => Object.values(value(b) ?? {}).filter(named)).slice(0, 60)

/** What a history is drawn with. */
export type HistoryProps = {
  e: Bundle
  io: Io
  notes: Map<string, Bundle[]>
  /** its heading (default `History`) */
  heading?: string
  /** the changes it tells, as a test on one `_change` column (default: those
   * aimed at `e`, or those `e` wrote when it is a transaction) */
  where?: string
  /** only the changes that wrote this property, and only it */
  prop?: string
  /** asked once, not kept live: for changes no index finds quickly (README,
   * Limits); nor counted, for the same reason */
  once?: boolean
}

/** A history: an entity's, a transaction's, or a component's writes. */
export let History = (p: HistoryProps): JSX.Element => {
  let { e, io } = p
  let eid = e.entity.eid
  let where = p.where ?? `${e._tx ? 'tx' : 'target'}=${eid}`
  let about1 = !where.startsWith('target=')
  let base = `._change&._change.${where}`
  let heading = p.heading ?? 'History'
  let id = key(eid, heading)
  // Newest first: a window runs newest first by the changes' own ids, which
  // rise with their transactions, and an index answers it (an order by `tx`
  // would sort every change of a component).
  let page = paged(io, id, base, { size: CHANGES })
  let got = io.ask({
    rows: p.once ? { query: page, once: true } : page,
    ...p.once ? {} : { total: `${base}&.count` },
  })
  let all = rows(got.rows).toSorted((a, b) =>
    str(b, '_change', 'tx').localeCompare(str(a, '_change', 'tx'))
  )
  let txs = unique(all.map((b) => str(b, '_change', 'tx')))
  let comps = unique(all.map((b) => str(b, '_change', 'comp')))
  io.ask(
    all.length
      ? {
        txs: `._tx&.entity.eid=${txs.join(',')}`,
        comps: `._comp&.entity.eid=${comps.join(',')}&.fields=_comp.name`,
      }
      : {},
  )
  let t = (tx: string) => comp(io.get(tx), '_tx')
  useNamed(io, [
    ...txs.flatMap((x) => [t(x).by as string, t(x).via as string]),
    ...about1 ? all.map((b) => str(b, '_change', 'target')) : [],
  ])
  useNamed(io, mentioned(all))
  let name = (b: Bundle) =>
    str(io.get(str(b, '_change', 'comp')), '_comp', 'name') || '…'
  // The next older change of the same component on the same entity.
  let older = (b: Bundle) =>
    all.slice(all.indexOf(b) + 1).find((o) =>
      str(o, '_change', 'comp') == str(b, '_change', 'comp') &&
      str(o, '_change', 'target') == str(b, '_change', 'target')
    )
  let told = p.prop ? all.filter((b) => p.prop! in (value(b) ?? {})) : all
  let moments = [...Map.groupBy(told, (b) => str(b, '_change', 'tx'))]
  let total = got.total?.count
  let target = (b: Bundle) => str(b, '_change', 'target')
  return h(
    Part,
    { io, eid, subject: about(io, e), heading, count: total, notes: p.notes },
    waiting(got.rows) ?? h(
      'div',
      {},
      !told.length ? none() : h(
        Timeline,
        {},
        moments.map(([x, cs]) => {
          let w = t(x)
          let by = typeof w.by == 'string' ? w.by : ''
          let via = typeof w.via == 'string' && w.via != by ? w.via : ''
          return h(
            Timeline.Item,
            { key: x },
            h(
              Timeline.When,
              {},
              h(
                'a',
                { href: io.link(x) },
                w.at ? io.when(String(w.at)) : `#${w.seq ?? '…'}`,
              ),
            ),
            h(Timeline.Who, {}, by ? mention(io, by) : ''),
            via ? ['via', h(Timeline.Who, {}, mention(io, via))] : null,
            cs.map((b) =>
              h(
                Timeline.What,
                { key: b.entity.eid },
                about1 ? mention(io, target(b)) : null,
                chip(io, name(b)),
                ...did(io, name(b), b, older(b), p.prop),
              )
            ),
          )
        }),
      ),
      h(Paging, {
        io,
        id,
        shown: all.length,
        last: all.at(-1)?.entity.eid,
        size: CHANGES,
        total,
        steps: ['‹ newer', 'older ›'],
      }),
    ),
  )
}
