/// <reference lib="deno.ns" />
import { test, tick } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, graph, transient } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { api } from './route.ts'
import { published } from './publish.ts'
import { subscriptions } from './subs.ts'
import { fake, post, req, shop } from './testing.ts'
import { queue } from './socket.ts'

let vocab = loadVocab([...shop.docs, {
  $defs: {
    ledger: {
      component: true,
      wire: false,
      sync: 'none',
      properties: {
        writes: { type: 'number' },
        text: { type: 'string' },
      },
    },
  },
}])

let setup = () => {
  let g = graph({
    vocab,
    storage: ram(vocab, { number: true }),
    plugins: [{
      name: 'ledger',
      hooks: {
        rules: (bundles) => [
          ...bundles,
          ...bundles.filter((b) => b.book || b.doc).map((b) => ({
            entity: b.entity,
            ledger: { writes: 1, text: 'private' },
          })),
        ],
      },
    }],
  })
  return { g, serve: api({ graph: g, authenticate: () => ({ by: 'ada' }) }) }
}

let note = (eid = 'b') => ({
  entity: { eid },
  book: { price: 7 },
  doc: { title: 'Dune', body: 'public' },
})

test('transport projection preserves stamps, identities, aliases and deletions', () => {
  let bundles: Bundle[] = [{
    entity: { eid: 'b', num: 7 },
    $alias: '$b',
    book: { price: 7 },
    created: { at: '2026-01-01T00:00:00.000Z', by: 'ada' },
    ledger: { writes: 1 },
  }, {
    entity: { eid: 'b' },
    tombstone: {},
    ledger: null,
  }]
  assertEquals(published(vocab, bundles), [
    {
      entity: bundles[0].entity,
      $alias: '$b',
      book: bundles[0].book,
      created: bundles[0].created,
    },
    { entity: { eid: 'b' }, tombstone: {} },
  ])
  assertEquals(bundles[0].ledger, { writes: 1 })
})

for (let streaming of [false, true]) {
  test(`node-local components stay stored but leave no ${streaming ? 'NDJSON' : 'JSON'} response`, async () => {
    let { g, serve } = setup()
    let response = await serve(
      streaming
        ? req('/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/x-ndjson' },
          body: JSON.stringify(note('$b')),
        })
        : post('/apply', [note('$b')]),
    )
    assertEquals(response.status, 200)
    let applied = streaming
      ? [JSON.parse((await response.text()).trim())]
      : await response.json() as Bundle[]
    assertEquals(applied[0].ledger, undefined)
    assertEquals(applied[0].$alias, '$b')
    assertEquals(applied[0].book, { price: 7 })
    assertEquals(applied[0].created.by, 'ada')
    let eid = applied[0].entity.eid
    assertEquals((await g.get([eid]))[0].ledger, { writes: 1, text: 'private' })
    let cached = graph({ vocab: shop, storage: ram(shop) })
    await cached.apply(applied, { trusted: true })
    for (let q of ['.book&*', '.book&.fields=book.price,ledger.writes']) {
      let rows = await (await serve(req(`/query?q=${encodeURIComponent(q)}`)))
        .json()
      assertEquals(rows[0].ledger, undefined)
      assertEquals(rows[0].book, { price: 7 })
      await cached.apply(rows, { trusted: true })
    }
    let deleted =
      await (await serve(post('/apply', [{ entity: { eid }, $delete: true }])))
        .json()
    assertEquals(deleted[0].tombstone, {})
    assertEquals(deleted[0].ledger, undefined)
  })
}

test('socket snapshots, batches and projections omit local data and its coverage', async () => {
  let { g } = setup()
  await g.apply([
    { entity: { eid: 'a' }, doc: { title: 'Author' } },
    { ...note(), book: { price: 7, author: 'a' } },
  ])
  let subs = subscriptions(g)
  let socket = fake()
  let sink = queue(socket).send
  await subs.open(sink, 'all', '.book&*')
  await subs.open(sink, 'raw', true)
  await subs.open(
    sink,
    'fields',
    '.book&.fields=book.price,ledger.writes,book.author.doc.title,book.author.ledger.writes',
  )
  let frames = socket.taken()
  assertEquals(
    frames.find((f) => f.id == 'all')?.bundles?.[0].ledger,
    undefined,
  )
  let fields = frames.find((f) => f.id == 'fields')!
  assertEquals(fields.coverage?.b, { book: ['price', 'author'] })
  assertEquals(fields.peerCoverage?.a, { doc: ['title'] })
  assertEquals(fields.peers?.[0].ledger, undefined)
  assertEquals(
    (await subs.snapshot('.book&*') as Bundle[])[0].ledger,
    undefined,
  )
  await g.apply([{ entity: { eid: 'b' }, book: { price: 8 } }])
  frames = socket.taken()
  assert(frames.some((f) => f.id == 'raw' && f.bundles?.[0].book))
  for (let frame of frames) {
    for (let row of frame.bundles ?? []) assertEquals(row.ledger, undefined)
  }

  let live = transient(g)
  let local = await live.begin('b', 'ledger', 'text', 'local')
  await tick()
  assertEquals(socket.taken(), [])
  await subs.open(sink, 'later', '.book&*')
  assertEquals(socket.taken()[0].transient, [])
  local.append(' secret')
  let publicText = await live.begin('b', 'doc', 'body', 'public')
  publicText.append(' text')
  await tick()
  frames = socket.taken()
  assert(frames.some((f) => f.transient?.some((t) => t.component == 'doc')))
  for (let frame of frames) {
    for (let t of frame.transient ?? []) assertEquals(t.component, 'doc')
  }
  await subs.drop(sink)
})
