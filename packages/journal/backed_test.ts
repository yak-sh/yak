/// <reference lib="deno.ns" />
// The journal read as entities: `_tx` and `_change` answer the same query
// grammar as anything else, from the journal's own rows, and are never
// written.

import { assertEquals, assertThrows } from '@std/assert'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { lit } from '@yaks/sql'
import { loadVocab, metaDoc } from '@yaks/vocab'
import { mem } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { backed, ddl, journal, log } from './mod.ts'
import { journalDoc } from './vocab.ts'
import { NOW, sync, wiki } from './testing.ts'

let vocab = loadVocab([...wiki.docs, edgeDoc, metaDoc, journalDoc], [
  edgeKeywords,
])

// A wiki journaling into its own database, read through the journal's
// backings. Three writes: ada makes p1, bob (through cli) retitles it and
// makes p2, ada deletes p2. A fourth describes `page` and `entity` as the
// `_comp` entities a change points at.
let fixture = () => {
  let db = mem()
  let store = storage(db, vocab, { backed: backed(vocab) })
  store.install()
  for (let s of ddl()) db.query(s)
  db.query({
    t: 'insert',
    into: 'entity',
    cols: ['eid'],
    rows: ['ada', 'bob', 'cli'].map((a) => [lit(a)]),
  })
  let g = graph({
    storage: store,
    vocab,
    plugins: [journal(log({ rows: (s) => db.query(s) }), { now: () => NOW })],
  })
  let apply = (change: Bundle[]) => sync(g.apply(change))
  apply([{ entity: { eid: 'p1' }, page: { title: 'Kickoff' }, $actor: ada }])
  apply([
    { entity: { eid: 'p1' }, page: { title: 'Retro' }, $actor: bob },
    { entity: { eid: 'p2' }, page: { title: 'Notes' }, $actor: bob },
  ])
  apply([{ entity: { eid: 'p2' }, $delete: true, $actor: ada }])
  let described = ['page', 'entity'].map((name) => ({
    entity: { eid: `$${name}` },
    _comp: { name },
  }))
  sync(g.apply(described, { trusted: true }))
  let read = (q: string) => sync(g.read(q))
  let rows = (q: string) => sync(g.rows(q))
  // What a change says, on one line, its component by the name its `_comp`
  // gives it: `page p1 {"title":"Retro"}`.
  let said = (bs: Bundle[]) => {
    let name = new Map(
      read('._comp').map((b) => [b.entity.eid, (b._comp as Comp).name]),
    )
    return bs.map((b) => {
      let c = b._change as Comp
      let comp = name.get(c.comp as string) ?? '-'
      return `${comp} ${c.target} ${JSON.stringify(c.value ?? null)}`
    })
  }
  return { g, read, rows, apply, said }
}
let ada = { by: 'ada' }
let bob = { by: 'bob', via: 'cli' }

Deno.test('an entity’s history is a query over its changes', () => {
  let { read, said } = fixture()
  assertEquals(said(read('._change.target=p1')), [
    'page p1 {"title":"Kickoff"}',
    'page p1 {"title":"Retro"}',
  ])
  assertEquals(said(read('._change.target=p2')), [
    'page p2 {"title":"Notes"}',
    'entity p2 null',
  ])
})

Deno.test('a change points at the _comp describing its component', () => {
  let { read, said } = fixture()
  assertEquals(said(read('._change.comp._comp.name=entity')), [
    'entity p2 null',
  ])
  let [page] = read('._comp.name=page')
  assertEquals(read(`._change.comp=${page.entity.eid}`).length, 3)
  // Nothing describes `_comp`, so the change that wrote one points at none.
  assertEquals(said(read(`._change.target=${page.entity.eid}`)), [
    `- ${page.entity.eid} {"name":"page"}`,
  ])
})

Deno.test('a change names its transaction, which reads like any entity', () => {
  let { g, read } = fixture()
  let [first, second] = read('._change.target=p1')
  let tx = (first._change as { tx: string }).tx
  let [{ entity, _tx }] = sync(g.get([tx]))
  let { seq, at, by, via } = _tx as Record<string, unknown>
  assertEquals([entity.eid, seq, at, by, via], [tx, 1, NOW, 'ada', null])
  assertEquals(read(`._change.tx=${tx}`).map((b) => b.entity.eid), [
    first.entity.eid,
  ])
  assertEquals(read(`.eid=${second.entity.eid}`), [second])
})

Deno.test('a transaction is found by who wrote it, and through it', () => {
  let { read, said } = fixture()
  let seqs = (q: string) => read(q).map((b) => (b._tx as { seq: number }).seq)
  assertEquals(seqs('._tx.via=cli'), [2])
  assertEquals(seqs('.kind=_tx&._tx.by=ada'), [1, 3])
  assertEquals(said(read('._change.tx._tx.via=cli')), [
    'page p1 {"title":"Retro"}',
    'page p2 {"title":"Notes"}',
  ])
  assertEquals(said(read('._change.target.page.title=Retro')), [
    'page p1 {"title":"Kickoff"}',
    'page p1 {"title":"Retro"}',
  ])
})

Deno.test('a history pages newest first', () => {
  let { read, rows, said } = fixture()
  let [last] = read('._change.target=p1&.limit=1')
  assertEquals(said([last]), ['page p1 {"title":"Retro"}'])
  assertEquals(
    said(read(`._change.target=p1&.limit=1&.after=${last.entity.eid}`)),
    ['page p1 {"title":"Kickoff"}'],
  )
  assertEquals(rows('._change.target=p1&.count'), [{ value: '', n: 2 }])
})

Deno.test('an entity counts its changes by the reverse association', () => {
  let { read } = fixture()
  assertEquals(read('.page&._changes_target>=2').map((b) => b.entity.eid), [
    'p1',
  ])
})

Deno.test('the journal is no part of any other answer', () => {
  let { read } = fixture()
  assertEquals(read('.page').map((b) => b.entity.eid), ['p1'])
  assertEquals(read('._change.target=p1&.page'), [])
  assertEquals(read('.refs=p1'), [])
})

Deno.test('nothing writes the journal’s components', () => {
  let { apply, g } = fixture()
  let change = { tx: null, target: 'p1', value: {} }
  assertEquals(apply([{ entity: { eid: 'x' }, _change: change }]), [])
  assertThrows(
    () =>
      sync(
        g.apply([{ entity: { eid: 'x' }, _change: change }], { trusted: true }),
      ),
    Error,
    'computed',
  )
})

Deno.test('a replica answers a history query the same way', () => {
  let { read } = fixture()
  let copy = graph({ storage: ram(vocab), vocab })
  let rows = read('._change.target=p2')
  sync(copy.apply(rows, { trusted: true, replica: true }))
  assertEquals(sync(copy.read('._change.target=p2')), rows)
})
