/// <reference lib="deno.ns" />
// Subscriptions over a bookshop: what a subscriber is told when the graph
// moves under it, and — just as much the point — what it is never told.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { col, count, eq, lit, select, sub, table } from '@yaks/sql'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { loadVocab } from '@yaks/vocab'
import { backed, ddl, journal, log } from '@yaks/journal'
import { journalDoc } from '@yaks/journal/vocab'
import { comp, shop as shopVocab, shopGraph } from './testing.ts'
import { type Frame, type Sink, subscriptions } from './subs.ts'

// A sink that remembers, and hands over what it has heard since last asked.
let ear = () => {
  let heard: Frame[] = []
  let to: Sink = (f) => {
    heard.push(f)
  }
  return { to, take: () => heard.splice(0, heard.length) }
}

let ids = (f: Frame) => (f.bundles ?? []).map((b) => b.entity.eid)

let shop = (): Graph => shopGraph()

test('a subscription opens on the set it already selects', () => {
  let graph = shop()
  graph.apply([
    { entity: { eid: 'b1' }, book: { price: 12 } },
    { entity: { eid: 'b2' }, book: { price: 30 } },
  ])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  let [first] = take()
  assertEquals(first.id, 'cheap')
  assertEquals(ids(first), ['b1'])
})

test('restoring shared watches reads each answer once and keeps each live', () => {
  let g = shop()
  g.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let reads = 0, counts = 0
  let spy: Graph = {
    ...g,
    read: (q, opts) => (reads++, g.read(q, opts)),
    rows: (q, opts) => (counts++, g.rows(q, opts)),
  }
  let subs = subscriptions(spy)
  let ears = Array.from({ length: 4 }, ear)
  subs.restore(ears.flatMap(({ to }, i) => [
    { sink: to, id: `books${i}`, query: '.price<20' },
    { sink: to, id: `count${i}`, query: '.book&.count' },
  ]))
  assertEquals([reads, counts], [1, 1])
  for (let [i, e] of ears.entries()) {
    assertEquals(
      e.take().map((f) => [
        f.id,
        ids(f),
        'count' in f ? f.count : undefined,
      ]),
      [
        [`books${i}`, ['b1'], undefined],
        [`count${i}`, [], 1],
      ],
    )
  }

  g.apply([{ entity: { eid: 'b2' }, book: { price: 9 } }])
  for (let [i, e] of ears.entries()) {
    assertEquals(
      e.take().map((f) => [
        f.id,
        ids(f),
        'count' in f ? f.count : undefined,
      ]),
      [
        [`books${i}`, ['b2'], undefined],
        [`count${i}`, [], 2],
      ],
    )
  }

  let later = ear()
  subs.open(later.to, 'later', '.price<20')
  assertEquals(ids(later.take()[0]), ['b1', 'b2'])
  assertEquals(reads, 2)
})

test('a commit pushes what the query selects, and nothing else', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  take()

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let [hit] = take()
  assertEquals(ids(hit), ['b1'])
  assertEquals(comp(hit.bundles![0], 'book').price, 12)

  // an entity the query does not select is never mentioned
  graph.apply([{ entity: { eid: 'b2' }, book: { price: 30 } }])
  assertEquals(take(), [])
})

test('backlinks change only when a referrer changes', () => {
  let g = shop()
  g.apply([{ entity: { eid: 'a1' }, doc: { title: 'Author' } }])
  let subs = subscriptions(g)
  let { to, take } = ear()
  subs.open(to, 'back', '.refs=a1&?book')
  assertEquals(take().map(ids), [[]])

  g.apply([{ entity: { eid: 'other' }, doc: { title: 'Elsewhere' } }])
  assertEquals(take(), [])

  g.apply([{
    entity: { eid: 'b1' },
    book: { author: 'a1' },
    doc: { body: 'A large body stays out of the backlink frame.' },
  }])
  let [joined] = take()
  assertEquals(ids(joined), ['b1'])
  assertEquals(joined.bundles?.[0].doc, undefined)
  g.apply([{ entity: { eid: 'b1' }, book: { author: null } }])
  assertEquals(take().map((f) => f.gone), [['b1']])
})

test('an aggregate is answered with its value, and again when it moves', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { status: 'shelved' } }])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'n', '.book&.count')
  subs.open(to, 'by', '.book&.tally=status')
  assertEquals(take(), [
    { id: 'n', count: 1 },
    { id: 'by', tally: { shelved: 1 } },
  ])
  graph.apply([{ entity: { eid: 'b2' }, book: { status: 'sold' } }])
  assertEquals(take(), [
    { id: 'n', count: 2 },
    { id: 'by', tally: { shelved: 1, sold: 1 } },
  ])
  // a commit that leaves the value where it was says nothing
  graph.apply([{ entity: { eid: 'b2' }, book: { price: 9 } }])
  assertEquals(take(), [])
})

test('a count without a component filter follows births and deaths', () => {
  let graph = shop(), subs = subscriptions(graph), e = ear()
  subs.open(e.to, 'all', '.count')
  assertEquals(e.take(), [{ id: 'all', count: 0 }])
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(e.take(), [{ id: 'all', count: 1 }])
  graph.apply([{ entity: { eid: 'b1' }, $delete: true }])
  assertEquals(e.take(), [{ id: 'all', count: 0 }])
})

// `*` asks which components an answer carries, not which entities belong, so a
// line wearing it subscribes exactly as the line without it does — incremental,
// judged per bundle. Read as a text term instead, it matched nothing and the
// subscription went silent (T-34070).
test('`*` projects, and never narrows a subscription', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20&*')
  take()

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let [hit] = take()
  assertEquals(ids(hit), ['b1'])
  assertEquals(comp(hit.bundles![0], 'book').price, 12)

  graph.apply([{ entity: { eid: 'b2' }, book: { price: 30 } }])
  assertEquals(take(), [])
})

// What a frame says about its bundles, riders and coverage, and nothing else.
let told = (f: Frame) =>
  Object.fromEntries(
    Object.entries({
      bundles: f.bundles,
      coverage: f.coverage,
      peers: f.peers,
      peerCoverage: f.peerCoverage,
      peerGone: f.peerGone,
      gone: f.gone?.length ? f.gone : undefined,
    }).filter(([, v]) => v !== undefined),
  )
let author = (eid: string, title: string) => ({
  entity: { eid },
  doc: { title },
})

test('a projection sends what it names, and says what that covers', () => {
  let graph = shop()
  graph.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { price: 12 } },
  ])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20&.fields=doc.title')
  let dune = { entity: { eid: 'b1' }, doc: { title: 'Dune' } }
  assertEquals(take().map(told), [{
    bundles: [dune],
    coverage: { b1: { doc: ['title'] } },
  }])

  graph.apply([{ entity: { eid: 'b2' }, book: { price: 9 } }])
  assertEquals(take().map(told), [{
    bundles: [{ entity: { eid: 'b2' } }],
    coverage: { b2: { doc: ['title'] } },
  }])
})

test('a projection carries what its paths reach, and follows it', () => {
  let graph = shop()
  graph.apply([
    author('a1', 'Ada'),
    author('a2', 'Bo'),
    { entity: { eid: 'b1' }, book: { price: 12, author: 'a1' } },
  ])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'by', '.book&.fields=book.price,book.author.doc.title')
  let book = (author: string) => ({
    entity: { eid: 'b1' },
    book: { price: 12, author },
  })
  let covered = {
    coverage: { b1: { book: ['price', 'author'] } },
  }
  assertEquals(take().map(told), [{
    bundles: [book('a1')],
    ...covered,
    peers: [author('a1', 'Ada')],
    peerCoverage: { a1: { doc: ['title'] } },
  }])

  // a rename where a path reaches
  graph.apply([author('a1', 'Ada L')])
  assertEquals(take().map((f) => f.peers), [[author('a1', 'Ada L')]])

  // the reference moves: the new author rides and the old one leaves
  graph.apply([{ entity: { eid: 'b1' }, book: { author: 'a2' } }])
  assertEquals(take().map(told), [{
    bundles: [book('a2')],
    ...covered,
    peers: [author('a2', 'Bo')],
    peerCoverage: { a2: { doc: ['title'] } },
    peerGone: ['a1'],
  }])

  // and nothing rides once nothing selects the book
  graph.apply([{ entity: { eid: 'b1' }, $delete: true }])
  assertEquals(take().map(told), [{
    bundles: [],
    coverage: {},
    peers: [],
    peerCoverage: {},
    peerGone: ['a2'],
    gone: ['b1'],
  }])
})

test('an entity that stops matching is reported gone', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  take()

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 99 } }])
  let [left] = take()
  assertEquals(left.gone, ['b1'])
  assertEquals(ids(left), [])
})

test('a deleted member is reported gone', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'cheap', '.price<20')
  take()

  graph.apply([{ entity: { eid: 'b1' }, $delete: true }])
  assertEquals(take()[0].gone, ['b1'])
})

test('the raw feed carries the batch exactly as it was applied', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'all', true)
  assertEquals(take(), []) // a raw feed has no opening set

  // The same answer the writer got: one bundle per entity, its patch and its
  // stamp together — and none of the `$` keys the phases spoke with (T-34294).
  graph.apply([{
    entity: { eid: 'b1' },
    doc: { title: 'Spring' },
    $actor: { by: 'ada' },
  }])
  let [batch] = take()
  assertEquals(batch.id, 'all')
  assertEquals(batch.bundles!.length, 1)
  let [one] = batch.bundles!
  assertEquals(comp(one, 'doc'), { title: 'Spring' })
  assertEquals(comp(one, 'created').by, 'ada')
  assert(comp(one, 'created').at != null)
  assertEquals(one.$actor, undefined)
})

test('a windowed query re-reads its whole answer', () => {
  let graph = shop()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(graph)
  let { to, take } = ear()
  // `.limit` pages newest-first, so this set can change when an entity the
  // batch never named moves — the fallback path, not the per-bundle test.
  subs.open(to, 'newest', '.price<20&.limit=1')
  assertEquals(ids(take()[0]), ['b1'])

  graph.apply([{ entity: { eid: 'b2' }, book: { price: 10 } }])
  let [moved] = take()
  assertEquals(ids(moved), ['b2'])
  assertEquals(moved.gone, ['b1'])
})

test('a windowed query ignores writes outside its fixed owner', () => {
  let g = shop()
  g.apply([
    { entity: { eid: 'b1' }, book: { price: 12 } },
    { entity: { eid: 'b2' }, book: { price: 15 } },
    { entity: { eid: 'r1' }, review: { book: 'b1', stars: 3 } },
    { entity: { eid: 'r2' }, review: { book: 'b2', stars: 4 } },
  ])
  let reads: string[] = []
  let spy: Graph = {
    ...g,
    read: (q, o) => (reads.push(String(q)), g.read(q, o)),
  }
  let subs = subscriptions(spy)
  let { to, take } = ear()
  let query = '.review.book=b1&.order=-review.stars&.limit=1'
  subs.open(to, 'reviews', query)
  assertEquals(ids(take()[0]), ['r1'])
  reads.length = 0

  g.apply([{ entity: { eid: 'r2' }, review: { stars: 5 } }])
  assertEquals(reads, [])
  assertEquals(take(), [])

  g.apply([{ entity: { eid: 'r2' }, review: { book: 'b1' } }])
  assertEquals(ids(take()[0]), ['r2'])

  g.apply([{ entity: { eid: 'r2' }, review: { book: 'b2' } }])
  let [left] = take()
  assertEquals(ids(left), ['r1'])
  assertEquals(left.gone, ['r2'])
})

test('windowed property filters skip births without their components', () => {
  let g = shop()
  let reads: string[] = []
  let spy: Graph = {
    ...g,
    read: (q, o) => (reads.push(String(q)), g.read(q, o)),
  }
  let subs = subscriptions(spy), e = ear()
  let review = '.review.stars=3&?created&.order=-created.at&.limit=10'
  let book = '.book.price=9&?created&.order=-created.at&.limit=10'
  let bare = '.review&?created&.limit=10'
  subs.open(e.to, 'reviews', review)
  subs.open(e.to, 'books', book)
  subs.open(e.to, 'bare', bare)
  e.take()
  reads = []

  g.apply([{ entity: { eid: 'note' }, doc: { title: 'Unrelated' } }])
  assertEquals([reads, e.take()], [[], []])

  g.apply([{ entity: { eid: 'r1' }, review: { stars: 3 } }])
  assertEquals(reads, [review, bare])
  assertEquals(e.take().map((f) => [f.id, ids(f)]), [
    ['reviews', ['r1']],
    ['bare', ['r1']],
  ])

  reads = []
  g.apply([{ entity: { eid: 'b1' }, book: { price: 9 } }])
  assertEquals(reads, [book])
  assertEquals(e.take().map((f) => [f.id, ids(f)]), [['books', ['b1']]])

  reads = []
  g.apply([{ entity: { eid: 'b1' }, book: null }])
  assertEquals(reads, [book])
  assertEquals(e.take().map((f) => [f.id, f.gone]), [['books', ['b1']]])
})

test('a created edit on a member refreshes its window', () => {
  let g = graph({
    storage: ram(shopVocab),
    vocab: shopVocab,
    provenance: () => ({ kind: 'created' }),
  })
  g.apply([{ entity: { eid: 'r1' }, review: { book: 'owner' } }], {
    now: '2026-01-01T00:00:00.000Z',
  })
  let reads: string[] = []
  let spy: Graph = {
    ...g,
    read: (q, o) => (reads.push(String(q)), g.read(q, o)),
  }
  let subs = subscriptions(spy), e = ear()
  let query = '.review.book=owner&?created&.order=-created.at&.limit=10'
  subs.open(e.to, 'reviews', query)
  e.take()
  reads = []

  g.apply([{ entity: { eid: 'r1' }, doc: { title: 'Edited' } }], {
    now: '2026-01-02T00:00:00.000Z',
  })
  assertEquals(reads, [query])
  let [frame] = e.take()
  assertEquals(ids(frame), ['r1'])
  assertEquals(
    comp(frame.bundles![0], 'created').at,
    '2026-01-02T00:00:00.000Z',
  )
})

test('a derived value can join a window without its component', () => {
  let store = storage(open(':memory:'), shopVocab, {
    derived: {
      'review.stars': {
        tag: 'number',
        worn: false,
        expr: () => lit(3),
      },
      'review.book': {
        tag: 'eid',
        worn: false,
        expr: () => lit('owner'),
      },
    },
  })
  store.install()
  let g = graph({ storage: store, vocab: shopVocab })
  let subs = subscriptions(g), e = ear()
  subs.open(e.to, 'derived', '.review.stars>0&?created&.limit=10')
  subs.open(e.to, 'ref', '.review.book=owner&?created&.limit=10')
  e.take()

  g.apply([{ entity: { eid: 'note' }, doc: { title: 'A note' } }])
  assertEquals(e.take().map((f) => [f.id, ids(f)]), [
    ['derived', ['note']],
    ['ref', ['note']],
  ])
})

test('OR and absence keep births eligible for a window', () => {
  let g = shop(), subs = subscriptions(g), e = ear()
  let heard = () => e.take().map((f) => [f.id, ids(f).sort()])
  subs.open(
    e.to,
    'either',
    '(.book.price<20|.review.stars>0)&?created&.limit=10',
  )
  subs.open(e.to, 'without', '!doc&.limit=10')
  subs.open(e.to, 'unequal', '.book.price!=20&.limit=10')
  e.take()

  g.apply([{ entity: { eid: 'r1' }, review: { stars: 3 } }])
  assertEquals(heard(), [
    ['either', ['r1']],
    ['without', ['r1']],
    ['unequal', ['r1']],
  ])
  g.apply([{ entity: { eid: 'b1' }, book: { price: 9 } }])
  assertEquals(heard(), [
    ['either', ['b1', 'r1']],
    ['without', ['b1', 'r1']],
    ['unequal', ['b1', 'r1']],
  ])
  g.apply([{ entity: { eid: 'note' }, doc: { title: 'Has doc' } }])
  assertEquals(heard(), [
    ['either', ['b1', 'r1']],
    ['without', ['b1', 'r1']],
    ['unequal', ['b1', 'note', 'r1']],
  ])
})

// The shop again, where a book also counts its reviews: a computed property
// whose value lives on other entities, and says so with `reads`.
let rated = (reads = ['review']): Graph => {
  let vocab = loadVocab([...shopVocab.docs, {
    $defs: {
      book: {
        component: true,
        extends: true,
        type: 'object',
        properties: {
          reviewed: { type: 'number', computed: true, reads },
        },
      },
    },
  }])
  let store = storage(
    open(':memory:'),
    vocab,
    {
      derived: {
        'book.reviewed': {
          tag: 'number',
          expr: (o) =>
            sub(select({
              cols: [count()],
              from: table('review', 'r'),
              where: eq(col('book', 'r'), o),
            })),
        },
      },
    },
  )
  store.install()
  return graph({ storage: store, vocab })
}

test('a referenced computed dependency refreshes only its owner', () => {
  let g = rated(['review.book'])
  g.apply([
    { entity: { eid: 'b1' }, book: { price: 12 } },
    { entity: { eid: 'b2' }, book: { price: 15 } },
  ])
  let reads: unknown[] = []
  let spy: Graph = {
    ...g,
    read: (q, o) => (reads.push(q), g.read(q, o)),
  }
  let subs = subscriptions(spy)
  let one = ear()
  let two = ear()
  let query = '.book&.book.reviewed>=0&.fields=book.reviewed'
  subs.open(one.to, 'books', query)
  subs.open(two.to, 'books', query)
  one.take()
  two.take()
  reads.length = 0

  g.apply([{ entity: { eid: 'r1' }, review: { book: 'b1', stars: 5 } }])
  assertEquals(reads.length, 1)
  assertEquals(reads[0], query + '&.eid=b1')
  assertEquals(one.take().map(ids), [['b1']])
  assertEquals(two.take().map(ids), [['b1']])

  reads.length = 0
  g.apply([{ entity: { eid: 'r1' }, review: { stars: 4 } }])
  assertEquals(reads.length, 1)
  assertEquals(one.take().map(ids), [['b1']])
  assertEquals(two.take().map(ids), [['b1']])

  // A removed reference has no owner to read after the commit. Its old owner
  // still loses a review, so the complete answer must be checked.
  reads.length = 0
  g.apply([{ entity: { eid: 'r1' }, $delete: true }])
  assertEquals(reads, [query])
  assertEquals(one.take().map(ids), [['b1', 'b2']])
  assertEquals(two.take().map(ids), [['b1', 'b2']])
})

test('a subscription to an entity’s history hears each change', () => {
  let vocab = loadVocab([...shopVocab.docs, journalDoc])
  let sql = open(':memory:')
  let store = storage(sql, vocab, { backed: backed(vocab) })
  store.install()
  for (let s of ddl()) sql.query(s)
  let j = journal(log({ rows: (s) => sql.query(s) }))
  let g = graph({ storage: store, vocab, plugins: [j] })
  g.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let subs = subscriptions(g)
  let { to, take } = ear()
  let price = (f: Frame) =>
    (f.bundles ?? []).map((b) =>
      (comp(b, '_change').value as { price: number }).price
    )
  subs.open(to, 'history', '._change.target=b1')
  assertEquals(take().map(price), [[12]])
  g.apply([{ entity: { eid: 'b1' }, book: { price: 9 } }])
  assertEquals(take().map(price), [[12, 9]])
})

test('a computed property reading its own row refreshes that row', () => {
  let vocab = loadVocab([...shopVocab.docs, {
    $defs: {
      book: {
        component: true,
        extends: true,
        type: 'object',
        properties: {
          kind: { type: 'string', computed: true, reads: ['book.status'] },
        },
      },
    },
  }])
  let store = storage(open(':memory:'), vocab, {
    derived: {
      'book.kind': {
        tag: 'text',
        deps: ['book'],
        expr: () => col('status', 'book'),
      },
    },
  })
  store.install()
  let g = graph({ storage: store, vocab })
  g.apply([
    { entity: { eid: 'b1' }, book: { status: 'shelved' } },
    { entity: { eid: 'b2' }, book: { status: 'shelved' } },
  ])
  let reads: string[] = []
  let spy: Graph = {
    ...g,
    read: (q, o) => (reads.push(String(q)), g.read(q, o)),
  }
  let subs = subscriptions(spy)
  let { to, take } = ear()
  let q = '.book&(.book.kind=shelved|.book.price>100)&.fields=book.kind'
  subs.open(to, 'shelved', q)
  assertEquals(ids(take()[0]), ['b1', 'b2'])
  reads.length = 0

  g.apply([{ entity: { eid: 'b1' }, book: { status: 'sold' } }])
  assertEquals(reads, [q + '&.eid=b1'])
  assertEquals(take()[0].gone, ['b1'])

  reads.length = 0
  g.apply([{ entity: { eid: 'b2' }, book: { price: 10 } }])
  assertEquals(reads, [q + '&.eid=b2'])
  assertEquals(ids(take()[0]), ['b2'])
})

test('a refresh follows its query onto the entities it reads', () => {
  let g = rated()
  g.apply([
    { entity: { eid: 'b1' }, book: { price: 12 } },
    { entity: { eid: 'b2' }, book: { price: 15, author: 'a1' } },
    { entity: { eid: 'a1' }, doc: { title: 'Bo' } },
  ])
  let subs = subscriptions(g)
  let { to, take } = ear()
  subs.open(to, 'liked', '.book&.book.reviewed>0')
  subs.open(to, 'ada', '.book.author.doc.title=Ada')
  take()

  // a review moves the count it is read into, and its deletion moves it back
  g.apply([{ entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } }])
  assertEquals(take().map(ids), [['b1']])
  g.apply([{ entity: { eid: 'r1' }, $delete: true }])
  assertEquals(take().map((f) => f.gone), [['b1']])

  // a rename one hop away moves the book that names its author
  g.apply([{ entity: { eid: 'a1' }, doc: { title: 'Ada' } }])
  assertEquals(take().map(ids), [['b2']])
})

test('a commit that touches nothing a query reads does not run it', () => {
  let g = shop()
  let runs = 0
  let spy: Graph = {
    ...g,
    read: (q, o) => (runs++, g.read(q, o)),
    rows: (q, o) => (runs++, g.rows(q, o)),
  }
  let subs = subscriptions(spy)
  let { to, take } = ear()
  subs.open(to, 'newest', '.book&.price<20&.limit=1')
  subs.open(to, 'n', '.book&.count')
  take()
  let before = runs

  g.apply([{ entity: { eid: 'n1' }, doc: { title: 'a note' } }])
  assertEquals([runs - before, take()], [0, []])

  g.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(take().map((f) => f.id), ['newest', 'n'])
})

test('an unrelated change to a member does not read or repeat its answer', () => {
  let g = shop()
  g.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let reads: string[] = []
  let spy: Graph = {
    ...g,
    get: (
      eids,
      names,
    ) => (reads.push(`get ${eids.join(',')} ${names?.join(',') ?? '*'}`),
      g.get(eids, names)),
    read: (q, opts) => (reads.push(`read ${q}`), g.read(q, opts)),
  }
  let subs = subscriptions(spy)
  let e = ear()
  subs.open(e.to, 'routed', '.book&.book.price<20')
  subs.open(e.to, 'window', '.book&.book.price<20&.limit=1')
  e.take()
  reads = []

  g.apply([{ entity: { eid: 'b1' }, doc: { title: 'A title' } }])
  assertEquals(reads, [])
  assertEquals(e.take(), [])

  g.apply([{ entity: { eid: 'b1' }, book: { price: 13 } }])
  assertEquals(reads, [
    'get b1 book',
    'read .book&.book.price<20&.limit=1',
  ])
  assertEquals(e.take().map((f) => f.id), ['routed', 'window'])

  subs.open(e.to, 'doc', '.book&?doc&.limit=1')
  subs.open(e.to, 'whole', '.book&*&.limit=1')
  e.take()
  reads = []
  g.apply([{ entity: { eid: 'b1' }, doc: { title: 'A new title' } }])
  assertEquals(e.take().map((f) => f.id), ['doc', 'whole'])
  assertEquals(reads.filter((r) => r.startsWith('read ')).length, 2)
})

test('a component a query holds out is not one its members wear', () => {
  let g = shop()
  let subs = subscriptions(g)
  let { to, take } = ear()
  subs.open(to, 'plain', '.price<20&!doc&.limit=5')
  take()

  g.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(take().map(ids), [['b1']])
  g.apply([{ entity: { eid: 'b1' }, doc: { title: 'titled' } }])
  assertEquals(take().map((f) => f.gone), [['b1']])
})

test('a query the graph cannot answer is refused, not held', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let { to, take } = ear()
  subs.open(to, 'bad', '.colour=red')
  let [said] = take()
  assertEquals(said.id, 'bad')
  assert(said.refused)
  assert(said.bundles == null)

  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(take(), [])
})

test('closing and dropping stop the pushes', () => {
  let graph = shop()
  let subs = subscriptions(graph)
  let one = ear()
  let two = ear()
  subs.open(one.to, 'cheap', '.price<20')
  subs.open(two.to, 'cheap', '.price<20')
  one.take()
  two.take()

  subs.close(one.to, 'cheap')
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(one.take(), [])
  assertEquals(ids(two.take()[0]), ['b1'])

  subs.drop(two.to)
  graph.apply([{ entity: { eid: 'b2' }, book: { price: 9 } }])
  assertEquals(two.take(), [])
})

test('explicit dependency invalidation refreshes a query on unrelated writes', async () => {
  let g = shop()
  await g.apply([{ entity: { eid: 'book' }, book: { price: 3 } }])
  let subs = subscriptions(g, {
    invalidate: (query, applied) =>
      query == '.book' && applied.some((b) => b.doc != null),
  })
  let e = ear()
  await subs.open(e.to, 'books', '.book')
  e.take()
  await g.apply([{
    entity: { eid: 'note' },
    doc: { title: 'changed dependency' },
  }])
  assertEquals(e.take().map(ids), [['book']])
  subs.drop(e.to)
})
