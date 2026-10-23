/**
 * An entity as it was: what it held just after one of its transactions,
 * rebuilt from its history (@yaks/journal's `_change`), and a deleted
 * entity's page, which reads what it held last. Both read the way a page is
 * read and are never edited: a head saying when, and by whom; what it said
 * (./Entity.ts `Body`); what else it stated (./Facts.ts); and under them its
 * history (./History.ts), each moment of which opens its own version.
 *
 * A change's value is what it wrote of one component, so a version is every
 * change up to its transaction merged, oldest first: an upsert into its
 * component, a removal taking the component away, and a deletion (a change of
 * `entity` with no value) all of it, for the rest of that transaction.
 *
 * The history is asked once, its newest `VERSIONS` changes, and a version is
 * rebuilt from those; an entity with more says the older ones are left out.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { Body } from './Entity.ts'
import { Facts } from './Facts.ts'
import { History } from './History.ts'
import { useNamed } from './notes.ts'
import { type Comp, comp, str, unique } from './read.ts'
import { rows, waiting } from './rows.ts'
import { mention } from './value.ts'

/** How many of an entity's newest changes its versions are rebuilt from. */
export let VERSIONS = 500

/** One change a version is rebuilt from: its transaction, the name of the
 * component it wrote, and what it wrote there, or null where it removed it. */
export type Change = { tx: string; comp: string; value: Comp | null }

/** What an entity held just after a transaction, and whether that
 * transaction deleted it. */
export type Version = {
  tx: string
  held: Record<string, Comp>
  deleted: boolean
}

/**
 * Each transaction's version of an entity, oldest first, from its changes in
 * the order they were made.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let doc = (value: Record<string, unknown> | null) => ({ comp: 'doc', value })
 * assertEquals(versions([
 *   { tx: 't1', ...doc({ title: 'Plan', body: 'draft' }) },
 *   { tx: 't2', ...doc({ title: 'Plan B' }) },
 *   { tx: 't3', comp: 'entity', value: null },
 *   { tx: 't3', ...doc({ title: 'gone' }) },
 * ]), [
 *   { tx: 't1', held: { doc: { title: 'Plan', body: 'draft' } }, deleted: false },
 *   { tx: 't2', held: { doc: { title: 'Plan B', body: 'draft' } }, deleted: false },
 *   { tx: 't3', held: {}, deleted: true },
 * ])
 * ```
 */
export let versions = (changes: Change[]): Version[] => {
  let out: Version[] = []
  let held: Record<string, Comp> = {}
  for (let c of changes) {
    let last = out.at(-1)
    if (last?.tx != c.tx) out.push(last = { tx: c.tx, held, deleted: false })
    if (last.deleted || !c.comp) continue
    if (c.comp == 'entity') {
      if (c.value == null) [held, last.deleted] = [{}, true]
    } else if (c.value == null) {
      let { [c.comp]: _gone, ...rest } = held
      held = rest
    } else held = { ...held, [c.comp]: { ...held[c.comp], ...c.value } }
    last.held = held
  }
  return out
}

/** The version a page reads: the one just after `tx`, or without one the
 * last before a deletion, what a deleted entity held last. */
export let version = (all: Version[], tx?: string): Version | undefined =>
  tx ? all.find((v) => v.tx == tx) : all.findLast((v) => !v.deleted)

// An entity's versions, from its newest changes and the components they name.
let useVersions = (io: Io, eid: string) => {
  let got = io.ask({
    changes: {
      query: `._change&._change.target=${eid}&.limit=${VERSIONS}`,
      once: true,
    },
  })
  let all = rows(got.changes)
  let comps = unique(all.map((b) => str(b, '_change', 'comp')))
  io.ask(
    comps.length
      ? { comps: `._comp&.entity.eid=${comps.join(',')}&.fields=_comp.name` }
      : {},
  )
  let key = (b: Bundle) => [str(b, '_change', 'tx'), b.entity.eid].join(' ')
  let changes = all.toSorted((a, b) => key(a).localeCompare(key(b)))
    .map((b): Change => ({
      tx: str(b, '_change', 'tx'),
      comp: str(io.get(str(b, '_change', 'comp')), '_comp', 'name'),
      value: (comp(b, '_change').value ?? null) as Comp | null,
    }))
  return {
    answer: got.changes,
    list: versions(changes),
    cut: all.length >= VERSIONS,
  }
}

/** What a past page is drawn with. */
export type PastProps = {
  /** the entity: its eid, or the id that names it, which its history is
   * asked by */
  e: Bundle
  io: Io
  /** what the page calls it: the id in its address */
  id: string
  /** the transaction whose version it reads; without one, the last version
   * of a deleted entity */
  at?: string
  /** what shows when its history holds no such version */
  lost: JSX.Element
}

/** An entity as it was after a transaction, or as it was last, deleted. */
export let Past = ({ e, io, id, at, lost }: PastProps): JSX.Element => {
  let eid = e.entity.eid
  let { answer, list, cut } = useVersions(io, eid)
  let shown = version(list, at)
  let gone = at ? undefined : list.findLast((v) => v.deleted)
  let tx = at ?? gone?.tx
  io.ask(tx ? { tx: `._tx&.entity.eid=${tx}` } : {})
  let w = comp(io.get(tx ?? ''), '_tx')
  let by = typeof w.by == 'string' ? w.by : ''
  let via = typeof w.via == 'string' && w.via != by ? w.via : ''
  useNamed(io, [by, via])
  let wait = waiting(answer)
  if (wait) return wait
  if (!shown || !at && !gone) return lost
  let b: Bundle = { ...shown.held, entity: { ...e.entity } }
  let still: Io = { ...io, edits: false }
  return h(
    'div',
    { 'data-past': eid },
    h(
      ui.Head,
      {},
      h(
        ui.Head.Title,
        {},
        str(b, 'doc', 'title') || id,
        h(ui.Head.Id, {}, id),
        h(ui.Head.Kind, {}, io.kind(b)),
      ),
      h(
        ui.Head.Facts,
        {},
        h(
          'span',
          {},
          at ? 'as it was ' : 'deleted ',
          w.at ? io.when(String(w.at)) : '',
          by ? [' by ', mention(io, by)] : '',
          via ? [' via ', mention(io, via)] : '',
        ),
        at ? h('a', { href: io.link(eid) }, 'as it is') : null,
        cut ? `rebuilt from its newest ${VERSIONS} changes` : null,
      ),
    ),
    h(Body, { e: b, io: still, ctx: {}, got: {} }),
    h(Facts, { e: b, io: still, ctx: { notes: new Map() }, got: {} }),
    h(History, { e, io, notes: new Map() }),
  )
}
