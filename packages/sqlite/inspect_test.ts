import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { col, lit } from '@yaks/sql'
import { deletions, identity, inspect } from './inspect.ts'
import { open } from './db.ts'

let counted = open(':memory:')
counted.query({
  t: 'create table',
  name: 'note',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'body', type: 'text' },
  ],
})
counted.query({
  t: 'create index',
  name: 'note_body',
  on: 'note',
  cols: [col('body')],
})
counted.query({
  t: 'insert',
  into: 'note',
  cols: ['body'],
  rows: [[lit('private')]],
})

test('inspection reports unknown physical rows rather than scanning values', () => {
  using db = Object.assign(counted, { [Symbol.dispose]: counted.close })
  assertEquals(inspect(db), {
    tables: 1,
    shown: [{
      name: 'note',
      rows: null,
      indexCount: 1,
      indexes: ['note_body'],
    }],
    omitted: 0,
  })
  assertEquals(inspect(db, 0), { tables: 1, shown: [], omitted: 1 })
})

let identified = open(':memory:')
identified.query({
  t: 'create table',
  name: 'entity',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'eid', type: 'text' },
  ],
})
for (let name of ['tombstone', 'note']) {
  identified.query({
    t: 'create table',
    name,
    cols: [{ name: 'entity', type: 'integer' }, {
      name: 'body',
      type: 'text',
    }],
  })
}
identified.query({
  t: 'insert',
  into: 'entity',
  cols: ['id', 'eid'],
  rows: [[lit(1), lit('a')], [lit(2), lit('b')]],
})
identified.query({
  t: 'insert',
  into: 'note',
  cols: ['entity', 'body'],
  rows: [[lit(1), lit('secret')]],
})
identified.query({
  t: 'insert',
  into: 'tombstone',
  cols: ['entity'],
  rows: [[lit(2)]],
})

test('identity inspection sees graves and live component presence without values', () => {
  using db = Object.assign(identified, { [Symbol.dispose]: identified.close })
  assertEquals(identity(db, 'a'), {
    eid: 'a',
    exists: true,
    tombstoned: false,
    tables: ['note'],
    omitted: 0,
  })
  assertEquals(identity(db, 'b'), {
    eid: 'b',
    exists: true,
    tombstoned: true,
    tables: ['tombstone'],
    omitted: 0,
  })
  assertEquals(identity(db, 'missing'), {
    eid: 'missing',
    exists: false,
    tombstoned: false,
    tables: [],
    omitted: 0,
  })
})

// The README's physical diagnostic/repair example. Setup and repair are not
// the observation: capture each result before the timed behavior assertions.
let diagnosticDb = open(':memory:')
let diagnosticStore = storage(diagnosticDb, loadVocab([archetypeDoc, docDoc]), {
  counts: 'eager',
})
diagnosticStore.tx((tx) =>
  tx.patch([{ entity: { eid: 'diagnostic' }, doc: { title: 'A' } }])
)
let diagnosticBefore = {
  drift: drift(diagnosticDb).drifted,
  tables: identity(diagnosticDb, 'diagnostic').tables,
  rows: inspect(diagnosticDb).shown.find((t) => t.name == 'doc')?.rows,
}
diagnosticDb.query({
  t: 'update',
  table: 'entity',
  set: { archetype: lit(null) },
  where: by({ eid: 'diagnostic' }),
})
let diagnosticDrift = drift(diagnosticDb).sample
let diagnosticMended = mend(diagnosticDb)
diagnosticStore.tx(() => {
  diagnosticDb.query({ t: 'delete', from: 'doc' })
  reclassify(diagnosticDb, ['diagnostic'])
})
let diagnosticAfter = {
  drift: drift(diagnosticDb).drifted,
  rows: diagnosticStore.read('.doc'),
}
diagnosticDb.close()
test('physical diagnostics observe and repair an unclassified owner', () => {
  assertEquals(diagnosticBefore, { drift: 0, tables: ['doc'], rows: 1 })
  assertEquals(diagnosticDrift, ['diagnostic'])
  assertEquals(diagnosticMended, 1)
  assertEquals(diagnosticAfter, { drift: 0, rows: [] })
})

import { drift, mend, reclassify, storage } from './mod.ts'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype'
import { docDoc } from '@yaks/doc'
import { by } from '@yaks/sql'

let deleted = open(':memory:')
deleted.query({
  t: 'create table',
  name: 'tombstone',
  cols: [
    { name: 'entity', type: 'integer', pk: true },
    { name: 'deleted_at', type: 'text' },
  ],
})
let since = '2026-10-28T04:20:00.000Z', until = '2026-10-28T04:21:00.000Z'
deleted.query({
  t: 'insert',
  into: 'tombstone',
  cols: ['entity', 'deleted_at'],
  rows: Array.from({ length: 1002 }, (_, i) => [
    lit(i * 2 + 1),
    lit(i == 0 ? '2026-10-28T04:19:59.999Z' : i == 1001 ? until : since),
  ]),
})

let firstDeletions = deletions(deleted, { since, until })
let nextDeletions = deletions(deleted, {
  since,
  until,
  after: firstDeletions.next!,
})
test('deletion inspection counts a bounded page and resumes across sparse identities', () => {
  assertEquals(firstDeletions, {
    scanned: 1000,
    count: 999,
    minutes: { [since]: 999 },
    next: 1999,
  })
  assertEquals(nextDeletions, {
    scanned: 2,
    count: 1,
    minutes: { [since]: 1 },
    next: null,
  })
})

test('deletion inspection rejects an invalid window or cursor before reading', () => {
  for (
    let window of [
      { since: 'invalid', until },
      { since: until, until: since },
      { since, until, after: -1 },
    ]
  ) assertThrows(() => deletions(deleted, window), RangeError)
})
