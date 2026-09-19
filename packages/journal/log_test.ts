/// <reference lib="deno.ns" />
// What the log holds: a create, a patch and a death, in the order they
// happened, each with the actor that wrote it — and nothing about the batches
// that were refused. Plus the two things only an after-image log has to prove:
// that the before-side comes back right although it was never stored, and that
// a content-addressed column is recorded by its address rather than its bytes.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { effects } from '@yaks/effects'
import { ddl, journal, log } from './log.ts'
import { mem } from '../sqlite/harness.ts'
import { storage } from '../sqlite/mod.ts'
import { graph } from '@yaks/graph'
import { NOW, sync, wiki, wikiGraph, wikiLog } from './harness.ts'

let ada = { by: 'ada' }
let bob = { by: 'bob', via: 'cli' }

let fixture = () => {
  let { g, j } = wikiGraph()
  return { g, j, apply: (change: Bundle[]) => sync(g.apply(change)) }
}

// A batch, flattened to one line per delta: `1 ada page.title Kickoff→Retro`.
let lines = (f: { j: { history: (e: string) => unknown } }, eid: string) =>
  (f.j.history(eid) as {
    seq: number
    by: string | null
    deltas: {
      comp: string
      column: string | null
      before: unknown
      after: unknown
    }[]
  }[]).flatMap((b) =>
    b.deltas.map((d) =>
      `${b.seq} ${b.by} ${d.comp}${d.column ? '.' + d.column : ''} ` +
      `${JSON.stringify(d.before ?? null)}→${JSON.stringify(d.after ?? null)}`
    )
  )

Deno.test('history lists a create, two patches and a death, in order', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' }, $actor: ada }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Retro' }, $actor: bob }])
  f.apply([{ entity: { eid: 'p1' }, page: { text: 'notes' }, $actor: ada }])
  f.apply([{ entity: { eid: 'p1' }, $delete: true, $actor: bob }])
  assertEquals(lines(f, 'p1'), [
    '1 ada page null→{}',
    '1 ada page.title null→"Kickoff"',
    '2 bob page.title "Kickoff"→"Retro"',
    '3 ada page.text null→"notes"',
    '4 bob page {"title":"Retro","text":"notes"}→null',
    '4 bob tombstone null→{}',
  ])
})

Deno.test('a batch row carries the actor, the instrument and the moment', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' }, $actor: bob }])
  let [batch] = f.j.history('p1')
  assertEquals([batch.by, batch.via, batch.at, batch.seq], [
    'bob',
    'cli',
    NOW,
    1,
  ])
})

Deno.test('the provenance stamps are not recorded twice', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' }, $actor: ada }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Two' }, $actor: ada }])
  let stamps = f.j.history('p1').flatMap((b) => b.deltas.map((d) => d.comp))
    .filter((c) => c == 'created' || c == 'updated')
  assertEquals(stamps, [], 'created/updated live on the batch row')
})

Deno.test('a cascade casualty is recorded, whole, under its own entity', () => {
  let f = fixture()
  f.apply([
    { entity: { eid: 'p1' }, page: { title: 'One' } },
    { entity: { eid: 'n1' }, note: { text: 'aside', page: 'p1' } },
  ])
  f.apply([{ entity: { eid: 'p1' }, $delete: true, $actor: ada }])
  assertEquals(lines(f, 'n1').slice(-2), [
    '2 ada note {"text":"aside","page":"p1"}→null',
    '2 ada tombstone null→{}',
  ])
})

Deno.test('a component dropped is recorded whole, and a column cleared is not', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One', text: 'body' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { text: null } }])
  f.apply([{ entity: { eid: 'p1' }, page: null }])
  // The cleared column is still a column the component held — the log records
  // its after-image as null rather than forgetting it, so the state it hands
  // back names it too.
  assertEquals(lines(f, 'p1').slice(-2), [
    '2 null page.text "body"→null',
    '3 null page {"title":"One","text":null}→null',
  ])
})

Deno.test('a refused batch leaves no record', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }])
  try {
    f.apply([{
      entity: { eid: 'p1' },
      page: { title: 'Two' },
      $was: { page: { title: null } },
    }])
  } catch { /* the guard refused it, which is the point */ }
  assertEquals(f.j.history('p1').length, 1)
})

Deno.test('a batch that moved nothing writes no row', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }])
  f.apply([{ entity: { eid: 'p1' } }])
  assertEquals(f.j.history('p1').length, 1)
})

Deno.test('the reading an effect takes never reaches the caller', () => {
  let fired: string[] = []
  let fx = effects(wiki)
  let { g } = wikiGraph([fx])
  fx.created('page', (e) => fired.push(`created ${e.entity.eid}`))
  fx.changed('page', 'title', (e) => fired.push(`retitled ${e.entity.eid}`))
  let out = sync(g.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }]))
  sync(g.apply([{ entity: { eid: 'p1' }, page: { title: 'Two' } }]))
  assertEquals(fired, ['created p1', 'retitled p1'])
  assertEquals(
    out.flatMap((b) => Object.keys(b).filter((k) => k.startsWith('$'))),
    [],
    'the reading is shed before the batch is answered',
  )
})

Deno.test('the before-side is derived, and the state before a batch with it', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One', text: 'body' } }])
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'Two' } }])
  assertEquals(f.j.before('p1', 2), { page: { title: 'One', text: 'body' } })
  assertEquals(f.j.latest('p1'), 2)
  assertEquals(f.j.tip(), 2)
  assert(f.j.touchedSince('p1', 1))
  assert(!f.j.touchedSince('p1', 2))
})

Deno.test('every write of one column, anywhere, oldest first', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }])
  f.apply([{ entity: { eid: 'p2' }, page: { title: 'Two' } }])
  assertEquals(f.j.wrote('page', 'title'), [
    { target: 'p1', value: 'One', seq: 1 },
    { target: 'p2', value: 'Two', seq: 2 },
  ])
})

Deno.test('a value can be sought and scrubbed in place', () => {
  let f = fixture()
  f.apply([{ entity: { eid: 'p1' }, page: { title: 'hunter2' } }])
  let [hit] = f.j.seek('hunter2')
  assertEquals([hit.target, hit.comp, hit.column, hit.value], [
    'p1',
    'page',
    'title',
    'hunter2',
  ])
  f.j.scrubValue(hit.field, JSON.stringify('—'))
  assertEquals(f.j.seek('hunter2'), [])
  assertEquals(f.j.history('p1')[0].deltas.at(-1)?.after, '—')
})

// A column whose text the graph already keeps under a content address is
// recorded by that address, so the log costs a row per revision and not a copy
// of the document.
Deno.test('a content-addressed column is recorded by its address', () => {
  let db = mem()
  let store = storage(db, wiki)
  store.install()
  db.exec(ddl())
  db.exec(`create table if not exists body (
    id integer primary key, text text not null unique)`)
  let put = (text: string) =>
    Number(
      (db.query(
        `insert into body (text) values (?)
         on conflict(text) do update set text = excluded.text returning id`,
        [text],
      )[0] as { id: number }).id,
    )
  let j = log({
    rows: (sql, params) =>
      db.query(sql, params as never[]) as Record<string, unknown>[],
    cas: {
      at: (comp, column) => comp == 'page' && column == 'text',
      put,
      table: 'body',
      key: 'id',
      value: 'text',
    },
  })
  let g = graph({ storage: store, vocab: wiki, plugins: [journal(j)] })
  sync(g.apply([{ entity: { eid: 'p1' }, page: { text: 'a long body' } }]))
  sync(g.apply([{ entity: { eid: 'p2' }, page: { text: 'a long body' } }]))
  assertEquals(
    db.query('select count(*) as n from body', [])[0],
    { n: 1 },
    'the same text is landed once, and both rows point at it',
  )
  assertEquals(
    db.query(
      'select count(*) as n from journal_field where ref is not null',
      [],
    )[0],
    { n: 2 },
  )
  assertEquals(j.history('p1')[0].deltas.at(-1)?.after, 'a long body')
})

Deno.test('a second graph over the same log counts on from its tip', () => {
  let held = wikiLog()
  let one = held.g()
  let two = held.g()
  sync(one.apply([{ entity: { eid: 'p1' }, page: { title: 'One' } }]))
  sync(two.apply([{ entity: { eid: 'p2' }, page: { title: 'Two' } }]))
  assertEquals(held.j.history('p1')[0].seq, 1)
  assertEquals(held.j.history('p2')[0].seq, 2)
})
