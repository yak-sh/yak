/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { derivedEid, graph, type ReadOpts, transient } from '@yaks/graph'
import { personal } from '@yaks/member'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { api } from './route.ts'
import { type Frame, subscriptions } from './subs.ts'
import { post, req, shop, shopGraph } from './testing.ts'

let BOB = derivedEid('fixture:bob')

let privateVocab = loadVocab([...shop.docs, {
  $defs: {
    draft: {
      component: true,
      properties: {
        by: { type: 'string', ref: 'entity', death: 'keep' },
        text: { type: 'string' },
      },
    },
  },
}])
let privateGraph = (legacy = false) => {
  let g = graph({ vocab: privateVocab, storage: ram(privateVocab) })
  if (legacy) {
    g.use({
      name: 'old-preference',
      reads: (opts) => opts.speaks?.shop === 0,
      answer: (_ctx, rows) =>
        rows.map((b) => {
          if (!b.doc) return b
          let { doc, ...rest } = b
          return { ...rest, oldpreference: doc }
        }),
    })
  }
  g.use(personal(privateVocab, { draft: 'by', doc: 'entity' }))
  g.apply([
    { entity: { eid: 'ada' }, book: { price: 1 }, doc: { body: 'preference' } },
    {
      entity: { eid: 'secret' },
      book: { price: 2 },
      draft: { by: 'ada', text: 'draft' },
      doc: { body: 'draft' },
    },
  ], { trusted: true })
  return g
}

for (let [name, person] of [['bob', BOB], ['guest', null]] as const) {
  let g = shopGraph(), seen: (string | null | undefined)[] = []
  g.use({
    name: 'read-caller',
    reads: (opts) => opts.person !== undefined,
    answer: ({ opts }, rows) => {
      seen.push(opts.person)
      return rows
    },
  })
  let handler = api({
    graph: g,
    authenticate: () => person ? { by: person } : null,
    read: () => ({ speaks: {} }),
  })
  test(`HTTP binds ${name} identity for reads`, async () => {
    await handler(req('/query?q=.book'))
    equal(seen.splice(0), [person])
  })
  test(`HTTP binds ${name} identity for write replies`, async () => {
    await handler(
      post('/apply', [{ entity: { eid: 'b' }, book: { price: 1 } }]),
    )
    equal(seen.splice(0), [person])
  })
}

let privateRows = privateGraph(),
  watches = subscriptions(privateRows),
  frames: Frame[] = []
let sink = (f: Frame) => frames.push(f)
watches.open(sink, 'raw', true, { person: BOB })
test('raw subscription patches contain no private row', async () => {
  await watches.commit([{
    entity: { eid: 'secret' },
    doc: { body: 'new draft' },
  }])
  equal(frames.splice(0).flatMap((f) => f.bundles ?? []), [])
})
let removedRows = privateGraph(), removedFrames: Frame[] = []
removedRows.apply([{ entity: { eid: 'secret' }, $delete: true }], {
  trusted: true,
})
let removedWatches = subscriptions(removedRows)
removedWatches.open((frame) => removedFrames.push(frame), 'all', true, {
  person: BOB,
})
test('raw subscription removals contain no unknown private identity', async () => {
  await removedWatches.commit([{ entity: { eid: 'secret' }, $delete: true }])
  equal(removedFrames.splice(0).flatMap((f) => f.bundles ?? []), [])
})
test('subscription coverage omits private rows and preference aspects', async () => {
  await watches.open(sink, 'people', '.book&?doc', { person: BOB })
  let [people] = frames.splice(0)
  equal(people.bundles?.map((b) => b.entity.eid), ['ada'])
  equal(people.coverage, { ada: { book: true } })
})

let liveRows = privateGraph()
test('raw subscriptions filter private transient properties and entities', async () => {
  let g = liveRows, subs = subscriptions(g), frames: Frame[] = []
  await subs.open((f) => frames.push(f), 'raw', true, { person: BOB })
  let drafts = transient(g)
  drafts.receive({
    id: 'd',
    entity: 'secret',
    component: 'doc',
    property: 'body',
    seq: 0,
    op: 'begin',
    text: 'draft',
  })
  drafts.receive({
    id: 'p',
    entity: 'ada',
    component: 'doc',
    property: 'body',
    seq: 0,
    op: 'begin',
    text: 'preference',
  })
  await Promise.resolve()
  equal(frames.flatMap((f) => f.transient ?? []), [])
})

test('HTTP reductions carry the caller scope to the graph row interface', async () => {
  let g = shopGraph(), seen: ReadOpts | undefined
  let handler = api({
    graph: {
      ...g,
      rows: (_q, opts) => {
        seen = opts
        return [{ n: 0 }]
      },
    },
    authenticate: () => ({ by: BOB }),
  })
  equal(
    await (await handler(req('/query?q=' + encodeURIComponent('.book&.count'))))
      .json(),
    {
      count: 0,
    },
  )
  equal(seen?.person, BOB)
})

let foreignGraph = privateGraph(),
  foreign = api({ graph: foreignGraph, authenticate: () => ({ by: BOB }) })
for (
  let [label, q, expected] of [
    ['listing', '.draft&*', []],
    ['identity lookup', '.entity.eid=secret&*', []],
    ['count', '.draft&.count', { count: 0 }],
    ['private aspect predicate', '.doc.body=preference&.count', { count: 0 }],
  ] as const
) {
  test(`HTTP ${label} cannot reveal another person's private values`, async () => {
    equal(
      await (await foreign(req('/query?q=' + encodeURIComponent(q)))).json(),
      expected,
    )
  })
}
for (
  let [label, patch] of [
    ['edit', { entity: { eid: 'secret' }, draft: { text: 'stolen' } }],
    ['delete', { entity: { eid: 'secret' }, $delete: true }],
    ['forged creation', {
      entity: { eid: 'forged' },
      draft: { by: 'ada', text: 'stolen' },
    }],
  ] as const
) {
  test(`HTTP refuses a foreign private ${label}`, async () => {
    equal((await foreign(post('/apply', [patch]))).status, 403)
  })
}

let legacyGraph = privateGraph(true),
  legacyWatches = subscriptions(legacyGraph),
  legacyFrames: Frame[] = []
legacyWatches.open((frame) => legacyFrames.push(frame), 'all', true, {
  person: BOB,
  speaks: { shop: 0 },
})
test('raw caller vocabulary transformations cannot rename a private aspect past its policy', async () => {
  await legacyWatches.commit([{
    entity: { eid: 'ada' },
    doc: { body: 'private preference' },
  }])
  equal(
    legacyFrames.flatMap((frame) => frame.bundles ?? []).some((row) =>
      row.oldpreference
    ),
    false,
  )
})
