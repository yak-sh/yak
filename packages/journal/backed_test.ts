/// <reference lib="deno.ns" />
// The journal read as entities: `_tx` and `_change` answer the same query
// grammar as anything else, from the journal's own rows, and are never
// written.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { blobKeywords } from '@yaks/blob'
import { edgeKeywords } from '@yaks/edge'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, metaDoc } from '@yaks/vocab'
import { mem } from '../sqlite/testing.ts'
import { storage } from '../sqlite/mod.ts'
import { backed, ddl, journal, log } from './mod.ts'
import { journalDoc } from './vocab.ts'
import { actors, NOW, sync, wiki } from './testing.ts'

let vocab = loadVocab([...wiki.docs, metaDoc, journalDoc], [
  edgeKeywords,
  blobKeywords,
])

// A wiki journaling into its own database, read through the journal's
// backings. Three writes: ada makes p1, bob (through cli) retitles it and
// makes p2, ada deletes p2. A fourth describes `page` and `entity` as the
// `_comp` entities a change points at, which the journal keeps no history of,
// and a fifth makes a note, a component nothing describes.
let build = () => {
  let db = mem()
  let store = storage(db, vocab, { backed: backed(vocab) })
  store.install()
  for (let s of ddl()) db.query(s)
  actors(graph({ storage: store, vocab }))
  let g = graph({
    storage: store,
    vocab,
    plugins: [
      journal(log({ rows: (s) => db.query(s) }), vocab, { now: () => NOW }),
    ],
  })
  let apply = (bundles: Bundle[]) => sync(g.apply(bundles))
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
  apply([{ entity: { eid: 'n1' }, note: { text: 'aside' } }])
  let read = (q: string) => sync(g.read(q))
  let rows = (q: string) => sync(g.rows(q))
  // What a change says, on one line, its component by the name its `_comp`
  // gives it: `page p1 {"title":"Retro"}`.
  let name = new Map(
    read('._comp').map((b) => [b.entity.eid, (b._comp as Comp).name]),
  )
  let said = (bs: Bundle[]) => {
    return bs.map((b) => {
      let c = b._change as Comp
      let comp = name.get(c.comp as string) ?? '-'
      return `${comp} ${c.target} ${JSON.stringify(c.value ?? null)}`
    })
  }
  return { g, read, rows, apply, said }
}

// The wiki as every reading test sees it, built once: they only read. A test
// that writes builds its own.
let ada = { by: 'ada' }
let bob = { by: 'bob', via: 'cli' }
let built = build()
let fixture = () => built
let changes = built.read('._change.target=p1')
let [newest] = built.read('._change.target=p1&.limit=1')
let previous = built.read(
  `._change.target=p1&.limit=1&.after=${newest.entity.eid}`,
)

test('an entity’s history is a query over its changes', () => {
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

test('a change points at the _comp describing its component', () => {
  let { read, said } = fixture()
  assertEquals(said(read('._change.comp._comp.name=entity')), [
    'entity p2 null',
  ])
  let [page] = read('._comp.name=page')
  assertEquals(read(`._change.comp=${page.entity.eid}`).length, 3)
  // Nothing describes `note`, so the change that wrote one points at none.
  assertEquals(said(read('._change.target=n1')), ['- n1 {"text":"aside"}'])
})

test('a change names its transaction, which reads like any entity', () => {
  let { g } = fixture()
  let [first] = changes
  let tx = (first._change as { tx: string }).tx
  let [{ entity, _tx }] = sync(g.get([tx]))
  let { seq, at, by, via } = _tx as Record<string, unknown>
  assertEquals([entity.eid, seq, at, by, via], [tx, 1, NOW, 'ada', undefined])
})

test('a transaction selects its own changes', () => {
  let { read } = fixture()
  let [first] = changes
  let tx = (first._change as { tx: string }).tx
  assertEquals(read(`._change.tx=${tx}`).map((b) => b.entity.eid), [
    first.entity.eid,
  ])
})

test('a change reads by its own entity id', () => {
  let second = changes[1]
  assertEquals(fixture().read(`.entity.eid=${second.entity.eid}`), [second])
})

test('a transaction is found by who wrote it, and through it', () => {
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

test('a history pages newest first', () => {
  let { said } = fixture()
  assertEquals(said([newest]), ['page p1 {"title":"Retro"}'])
  assertEquals(said(previous), ['page p1 {"title":"Kickoff"}'])
})

test('a history counts every change despite its page size', () => {
  assertEquals(fixture().rows('._change.target=p1&.count'), [{
    value: '',
    n: 2,
  }])
})

test('a history reads who wrote each change through its transaction', () => {
  let { rows } = fixture()
  let by = '_change.tx._tx.by'
  let via = '_change.tx._tx.via'
  let q = `._change.target=p1&.order=-_change.tx._tx.seq&.fields=${by},${via}`
  assertEquals(rows(q).map(({ eid: _, ...r }) => r), [
    { [by]: 'bob', [via]: 'cli' },
    { [by]: 'ada', [via]: null },
  ])
  assertEquals(rows(`._change&.tally=${by}`), [
    { value: 'ada', n: 2 },
    { value: 'bob', n: 2 },
  ])
})

test('a batch carrying two writers’ work records each one’s as theirs', () => {
  let { apply, rows } = build()
  apply([
    { entity: { eid: 'p3' }, page: { title: 'Plan' }, $actor: ada },
    { entity: { eid: 'p4' }, page: { title: 'Minutes' }, $actor: bob },
  ])
  let by = '_change.tx._tx.by'
  let who = (eid: string) =>
    rows(`._change.target=${eid}&.fields=${by}`).map((r) => r[by])
  assertEquals([who('p3'), who('p4')], [['ada'], ['bob']])
})

test('an entity counts its changes by the reverse association', () => {
  let { read } = fixture()
  assertEquals(read('.page&._changes_target>=2').map((b) => b.entity.eid), [
    'p1',
  ])
})

// These fixed answers share the read-only wiki; no journal row may leak into them.
let ordinary = [
  built.read('.page'),
  built.read('._change.target=p1&.page'),
  built.read('.refs=p1'),
]
test('the journal is no part of any other answer', () => {
  assertEquals(ordinary[0].map((b) => b.entity.eid), ['p1'])
  assertEquals(ordinary[1], [])
  assertEquals(ordinary[2], [])
})

test('nothing writes the journal’s components', () => {
  let { apply, g } = build()
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

test('a replica answers a history query the same way', () => {
  let { read } = fixture()
  let copy = graph({ storage: ram(vocab), vocab })
  let rows = read('._change.target=p2')
  sync(copy.apply(rows, { trusted: true, replica: true }))
  assertEquals(sync(copy.read('._change.target=p2')), rows)
})
