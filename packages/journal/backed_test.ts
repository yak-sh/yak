/// <reference lib="deno.ns" />
// The journal read as entities: `_tx` and `_change` answer the same query
// grammar as anything else, from the journal's own rows, and are never
// written.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import {
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'
import { edgeKeywords } from '@yaks/edge'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import type { Visibility } from '@yaks/graph/storage'
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
  let derived = blobRead(vocab)
  let store = storage(db, vocab, { derived, backed: backed(vocab, derived) })
  store.install()
  for (let s of [...blobSchema(), ...ddl()]) db.query(s)
  actors(graph({ storage: store, vocab }))
  let g = graph({
    storage: store,
    vocab,
    plugins: [
      journal(log({ rows: (s) => db.query(s) }), vocab, { now: () => NOW }),
      blobs(vocab, sqliteBlobs(db)),
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
  // The same store as a reader under `visibility` reads it.
  let seen = (visibility: Visibility) =>
    graph({
      storage: store,
      vocab,
      plugins: [{ name: 'scope', scope: () => visibility }],
    })
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
  return { g, read, rows, apply, said, seen }
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

// A scoped reader sees the changes to what it may see, and the transactions
// that made one of them. Here the note n1 is private; p2 is deleted, and seen
// by a scope that would see it holding nothing, unless it once held what that
// scope tests (a page, under `!page`); a component's own scope hides that
// component's changes.
// Each scope's answers are read once, beside the wiki's; the test compares.
// A query and a gather by eid each decide what is seen, so each is asked.
let every = changes.concat(built.read('._change.target=p2,n1'))
  .map((b) => b.entity.eid)
let sees = (visibility: Visibility) => {
  let g = built.seen(visibility)
  let column = (q: string, f: string) => sync(g.rows(q)).map((r) => r[f])
  return {
    got: built.said(sync(g.get(every))),
    targets: column('._change&.fields=_change.target', '_change.target'),
    txs: column('._tx&.fields=_tx.seq', '_tx.seq'),
  }
}
let scoped = [
  sees({ entity: '!note' }),
  sees({ entity: '!page' }),
  sees({ components: { note: '!entity' } }),
]
test('a scoped read sees only the history of what it may see', () => {
  let p1 = ['page p1 {"title":"Kickoff"}', 'page p1 {"title":"Retro"}']
  let p2 = ['page p2 {"title":"Notes"}', 'entity p2 null']
  let pages = {
    got: [...p1, ...p2],
    targets: ['p1', 'p1', 'p2', 'p2'],
    txs: [1, 2, 3],
  }
  assertEquals(scoped, [
    pages,
    { got: ['- n1 {"text":"aside"}'], targets: ['n1'], txs: [4] },
    pages,
  ])
})

// A page's text is kept by its address (@yaks/blob), and its change says the
// text, as a reader of the page reads it.
let texted = build()
texted.apply([{ entity: { eid: 'w1' }, page: { title: 'Plan', text: 'Hi' } }])
let told = texted.read('._change.target=w1')
test('a change says the text a body is kept as', () => {
  assertEquals(told.map((b) => (b._change as Comp).value), [
    { title: 'Plan', text: 'Hi' },
  ])
})

// A deleted entity is seen by a scope that saw it as it last was and by no
// other, its existence included: a page (pd) by `!note`, a note (nd) by
// `!page` and by `.note.text=secret`, what it said last, as a person's scope
// sees their own draft by its `draft.by`, and an entity that held only what
// the journal keeps no history of (rd) by no scope. Each way to reach one is
// asked: a get, a reference to it (w's creator), a read asking for graves (as
// an id is resolved, @yaks/id), and its history by id. Read once; the test
// compares.
let mourned = build()
mourned.apply([
  { entity: { eid: 'pd' }, page: { title: 'Gone' } },
  { entity: { eid: 'nd' }, note: { text: 'draft' } },
  { entity: { eid: 'rd' }, render: { state: 'owed' } },
])
mourned.apply([{ entity: { eid: 'nd' }, note: { text: 'secret' } }])
sync(mourned.g.apply([
  { entity: { eid: 'w1' }, page: { title: 'W1' }, created: { by: 'pd' } },
  { entity: { eid: 'w2' }, page: { title: 'W2' }, created: { by: 'nd' } },
], { trusted: true }))
mourned.apply(
  ['pd', 'nd', 'rd'].map((eid) => ({ entity: { eid }, $delete: true })),
)
let reach = (visibility?: Visibility) => {
  let g = visibility ? mourned.seen(visibility) : mourned.g
  let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)
  return {
    got: eids(sync(g.get(['pd', 'nd', 'rd']))),
    creators: sync(g.get(['w1', 'w2'])).map((b) => (b.created as Comp)?.by),
    selected: eids(sync(g.read('.entity.eid=pd,nd,rd', { graves: true }))),
    history: ['pd', 'nd', 'rd'].map((eid) =>
      sync(g.rows(`._change&._change.target=${eid}&.count`))[0]?.n ?? 0
    ),
  }
}
let reached = [
  undefined,
  '!note',
  '!note|.note.text=secret',
  '!note|.note.text=draft',
  '!page',
].map((entity) => reach(entity ? { entity } : undefined))
test('a deleted entity is seen by a scope that saw it as it last was', () => {
  let pd = {
    got: ['pd'],
    creators: ['pd', null],
    selected: ['pd'],
    history: [2, 0, 0],
  }
  let both = {
    got: ['pd', 'nd'],
    creators: ['pd', 'nd'],
    selected: ['pd', 'nd'],
    history: [2, 3, 0],
  }
  assertEquals(reached, [
    {
      got: ['pd', 'nd', 'rd'],
      creators: ['pd', 'nd'],
      selected: ['pd', 'nd', 'rd'],
      history: [2, 3, 0],
    },
    pd,
    both,
    pd,
    { got: ['nd'], creators: [], selected: ['nd'], history: [0, 3, 0] },
  ])
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

// A replica given p2's history, made once beside the wiki.
let replica = graph({ storage: ram(vocab), vocab })
let p2 = built.read('._change.target=p2')
sync(replica.apply(p2, { trusted: true, replica: true }))
test('a replica answers a history query the same way', () => {
  assertEquals(sync(replica.read('._change.target=p2')), p2)
})
