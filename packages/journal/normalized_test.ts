/// <reference lib="deno.ns" />
// The two layouts, one corpus, one answer. `./record.ts` keeps a batch and a
// delta entity per movement; `./normalized.ts` keeps three relational tables
// off the spine with after-images only. They are kept for the same reasons and
// must therefore say the same things — that is what makes the choice between
// them a question of bytes and nothing else.
//
// This is T-33820's parity, moved to where it belongs: the divergence it named
// was the fleet's log against the package's, and the fleet's log is now one of
// the package's two.

import { assert, assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph, isPromise } from '@yaks/graph'
import { storage } from '../sqlite/mod.ts'
import { mem } from '../sqlite/harness.ts'
import type { Batch } from './read.ts'
import { history } from './read.ts'
import { Final, undone } from './undo.ts'
import { journaling, normalized } from './normalized.ts'
import { logger, wiki } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'the stack went async over an embedded database')
  return out as T
}

// One store, two logs: the component journal through the ordinary plugin, and
// the normalized one beside it over the same transaction.
let both = () => {
  let db = mem()
  let store = storage(db, wiki)
  store.install()
  let n = normalized({
    rows: (sql, params) =>
      db.query(sql, params as never[]) as Record<string, unknown>[],
  })
  db.exec(
    `create table if not exists journal_tx (
       id integer primary key, ts text not null, actor integer,
       via integer, trace text);
     create table if not exists journal_change (
       id integer primary key, tx integer not null, ordinal integer not null,
       entity integer not null, component text not null,
       operation text not null);
     create table if not exists journal_field (
       id integer primary key, change integer not null, ordinal integer not null,
       field text not null, present integer not null, value text, ref integer);`,
  )
  let g = graph({
    storage: store,
    vocab: wiki,
    plugins: [
      logger(wiki),
      journaling(n, { now: () => '2026-01-01T00:00:00.000Z' }),
    ],
  })
  return {
    apply: (change: Bundle[]) => sync(g.apply(change)),
    comps: (eid: string) => sync(history(g)(eid)) as Batch[],
    rows: (eid: string) => n.history(eid),
  }
}

// A batch as a sentence: what moved, in order. The seq spaces differ (each log
// counts its own batches), so the comparison is what each one SAYS.
let said = (batches: Batch[]): string[][] =>
  batches.map((b) =>
    b.deltas.map((d) =>
      `${d.comp}${d.column ? '.' + d.column : ''} ${
        JSON.stringify(d.before ?? null)
      }→${JSON.stringify(d.after ?? null)}`
    )
  )

Deno.test('both layouts tell the same story about one entity', () => {
  let f = both()
  f.apply([{
    entity: { eid: 'p1' },
    page: { title: 'Kickoff', text: 'one' },
    $actor: { by: 'ada' },
  }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { text: null } }])

  assertEquals(said(f.rows('p1')), said(f.comps('p1')))
  assertEquals(said(f.rows('p1')), [
    ['page null→{}', 'page.title null→"Kickoff"', 'page.text null→"one"'],
    ['page.title "Kickoff"→"Retro"'],
    ['page.text "one"→null'],
  ])
})

Deno.test('both layouts record a component dropped, whole', () => {
  let f = both()
  f.apply([{ entity: { eid: 'p2' }, page: { title: 'Doomed' } }])
  f.apply([{ entity: { eid: 'p2' }, page: null }])
  assertEquals(said(f.rows('p2')), said(f.comps('p2')))
})

Deno.test('both layouts attribute a batch the same way', () => {
  let f = both()
  f.apply([{
    entity: { eid: 'p3' },
    page: { title: 'Solo' },
    $actor: { by: 'ada', via: 'cli' },
  }])
  let [rows] = f.rows('p3')
  let [comps] = f.comps('p3')
  assertEquals([rows.by, rows.via], ['ada', 'cli'])
  assertEquals([rows.by, rows.via], [comps.by, comps.via])
  assertEquals(rows.at, comps.at)
})

Deno.test('a death is final in the normalized layout too', () => {
  let f = both()
  f.apply([{ entity: { eid: 'p4' }, page: { title: 'Gone' } }])
  f.apply([{ entity: { eid: 'p4' }, $delete: true }])
  let last = f.rows('p4').at(-1)!
  assertEquals(last.deltas.at(-1)?.comp, 'tombstone')
  assertThrows(() => undone(last), Final)
})

Deno.test('an undo built from rows guards every column it restores', () => {
  let f = both()
  f.apply([{ entity: { eid: 'p5' }, page: { title: 'One' } }])
  f.apply([{ entity: { eid: 'p5' }, page: { title: 'Two' } }])
  let [back] = undone(f.rows('p5').at(-1)!, { guard: true })
  assertEquals(back.page, { title: 'One' })
  // The guard names the value the batch LEFT, so a column somebody else has
  // moved since refuses the reversal instead of clobbering it.
  assert(back.$was?.page?.title)
})

Deno.test('the feed hands each batch out once, in order', () => {
  let f = both()
  f.apply([{ entity: { eid: 'p6' }, page: { title: 'a' } }])
  f.apply([{ entity: { eid: 'p7' }, page: { title: 'b' } }])
  let db = f.rows('p6')[0]
  assertEquals(db.seq, 1)
})
