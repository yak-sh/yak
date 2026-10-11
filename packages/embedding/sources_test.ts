// Eligibility is a property of the entity, across every piece of its text.
// Classified stores and older, partially classified stores agree on it.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { by, insert, scan, val } from '@yaks/sql'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { schema } from './ddl.ts'
import { fields, searched } from './fields.ts'
import { vectorOf } from './near.ts'
import { due, queues, watch } from './owed.ts'
import { sources, sweep } from './sweep.ts'
import { embedder } from './testing.ts'

let words: VocabDoc = {
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string', search: true },
        body: { type: 'string', search: true },
      },
    },
    draft: { component: true, type: 'object', embed: false },
    result: { component: true, type: 'object', embed: false },
    drafting: { component: true, type: 'object' },
  },
}
let fixture = async (classified = true) => {
  let vocab = loadVocab(classified ? [archetypeDoc, words] : [words])
  let store = storage(open(':memory:'), vocab)
  store.install()
  let db = store.statements
  for (let stmt of schema()) db.query(stmt)
  let g = graph({
    storage: store,
    vocab,
    plugins: classified ? [archetypes()] : [],
  })
  await g.apply(['plain', 'draft', 'result', 'both', 'drafting'].map((eid) => ({
    entity: { eid },
    doc: { title: eid, body: `${eid} body` },
    ...eid == 'both'
      ? { draft: {}, result: {} }
      : eid == 'plain'
      ? {}
      : { [eid]: {} },
  })))
  let text = fields(vocab, searched)
  return {
    db,
    text,
    read: (f = text) => sources(db, f).map((s) => [s.entity, s.text]),
    has: (eid: string) => !!vectorOf(db, eid, embedder.model),
    patch: (bundles: Bundle[]) => store.tx((tx) => tx.patch(bundles)),
    owner: (eid: string) =>
      Number(scan(db, 'entity', by({ eid }), ['id'])[0].id),
  }
}

let classified = await fixture()
let legacy = await fixture(false)
let partial = await fixture()
for (let eid of ['plain', 'draft']) {
  partial.db.query({
    t: 'update',
    table: 'entity',
    set: { archetype: val(null) },
    where: by({ eid }),
  })
}
for (let eid of ['result', 'both', 'drafting']) {
  partial.db.query({
    t: 'update',
    table: 'entity',
    // The pointer resolves to an entity, but it has no descriptor row.
    set: {
      archetype: val(
        Number(scan(partial.db, 'entity', by({ eid: 'plain' }), ['id'])[0].id),
      ),
    },
    where: by({ eid }),
  })
}
let visible = [['plain', 'plain\nplain body'], [
  'drafting',
  'drafting\ndrafting body',
]]

test('an exclusion write asks the host to drain its vector queue', () => {
  assertEquals(
    queues(classified.text, [{ entity: { eid: 'plain' }, draft: {} }]),
    true,
  )
  assertEquals(
    queues(classified.text, [{ entity: { eid: 'draft' }, draft: null }]),
    true,
  )
})

test('a classified entity excludes all its text when any word forbids embedding', () => {
  assertEquals(classified.read(), visible)
})

test('missing and null descriptors keep physical exclusions, like an older store', () => {
  assertEquals(partial.read(), visible)
  assertEquals(legacy.read(), visible)
})

test('each field keeps its own exclusions when they differ', () => {
  let text = classified.text.map((f) => ({
    ...f,
    not: [f.prop == 'title' ? 'draft' : 'result'],
  }))
  assertEquals(classified.read(text), [
    ['plain', 'plain\nplain body'],
    ['draft', 'draft body'],
    ['result', 'result'],
    ['drafting', 'drafting\ndrafting body'],
  ])
})

let reclassified = await fixture()
reclassified.patch([{ entity: { eid: 'plain' }, draft: {} }])

test('a new exclusion changes the classified owner eligibility', () => {
  assertEquals(reclassified.read(), [['drafting', 'drafting\ndrafting body']])
})

let restored = await fixture()
restored.patch([{ entity: { eid: 'draft' }, draft: null }])

test('removing an exclusion restores the classified owner eligibility', () => {
  assertEquals(restored.read(), [
    ['plain', 'plain\nplain body'],
    ['draft', 'draft\ndraft body'],
    ['drafting', 'drafting\ndrafting body'],
  ])
})

// A plain SQL host uses the same queue triggers, without graph classification.
let moved = await fixture(false)
await sweep(moved.db, moved.text, embedder)

test('an arriving exclusion spends its old vector', async () => {
  assertEquals(moved.has('plain'), true)
  moved.db.query(insert('draft', { entity: moved.owner('plain') }))
  await sweep(moved.db, moved.text, embedder)
  assertEquals(moved.has('plain'), false)
})

test('a departing exclusion restores an eligible vector', async () => {
  assertEquals(moved.has('draft'), false)
  moved.db.query({
    t: 'delete',
    from: 'draft',
    where: by({ entity: moved.owner('draft') }),
  })
  await sweep(moved.db, moved.text, embedder)
  assertEquals(moved.has('draft'), true)
})

let deleted = await fixture()
await sweep(deleted.db, deleted.text, embedder)
deleted.db.query(insert('tombstone', {
  entity: deleted.owner('plain'),
  deleted_at: '2026-10-11T00:00:00Z',
}))

test('a tombstone stops its text being a source', () => {
  assertEquals(deleted.read(), [['drafting', 'drafting\ndrafting body']])
})

test('a queued tombstone spends its old vector', async () => {
  assertEquals(deleted.has('plain'), true)
  await sweep(deleted.db, deleted.text, embedder)
  assertEquals(deleted.has('plain'), false)
})

// Reconcile triggers as a deploy would, after the old vocabulary's queue was
// drained. The corpus and its vectors predate the changed exclusion.
let empty = await fixture(false)
empty.db.query({ t: 'delete', from: 'draft' })
let beforeDraft = empty.text.map((f) => ({ ...f, not: ['result'] }))
await sweep(empty.db, beforeDraft, embedder)
let addedEmpty = watch(empty.db, empty.text)

test('installing an empty exclusion queues none of the existing corpus', () => {
  assertEquals(addedEmpty, true)
  assertEquals(due(empty.db, 64), [])
  assertEquals(empty.has('plain'), true)
})

let introduced = await fixture(false)
await sweep(introduced.db, beforeDraft, embedder)
watch(introduced.db, introduced.text)

test('installing an exclusion queues only its preexisting vector owners', () => {
  assertEquals(due(introduced.db, 64).map((d) => d.owner), [
    introduced.owner('draft'),
  ])
})

test('a newly installed exclusion prunes its preexisting vector', async () => {
  assertEquals(introduced.has('draft'), true)
  await sweep(introduced.db, introduced.text, embedder)
  assertEquals(introduced.has('draft'), false)
  assertEquals(introduced.has('plain'), true)
})

let unblocked = await fixture(false)
await sweep(unblocked.db, unblocked.text, embedder)
watch(unblocked.db, beforeDraft)

test('removing an exclusion queues its newly eligible nonvector owners', () => {
  assertEquals(due(unblocked.db, 64).map((d) => d.owner), [
    unblocked.owner('draft'),
  ])
})

test('a removed exclusion restores its formerly blocked vector', async () => {
  assertEquals(unblocked.has('draft'), false)
  await sweep(unblocked.db, beforeDraft, embedder)
  assertEquals(unblocked.has('draft'), true)
})
