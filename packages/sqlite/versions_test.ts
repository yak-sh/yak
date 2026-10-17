import { equal, ok, test } from '@yaks/testing'
import { col, eq, insert, lit, select, table } from '@yaks/sql'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { catalog } from './catalog.ts'
import { meta } from './meta.ts'
import { storage } from './mod.ts'
import { mem, shop } from './testing.ts'
import { tableVersion, versioned } from './versions.ts'

let vocab = loadVocab([...shop.docs, archetypeDoc])

// Rebinding a file schema on a single-owner host retires its peer clock while
// preserving the rows. Raw local mutations still invalidate the catalog.
let local = mem()
let shared = storage({ ...local, file: true }, vocab)
shared.install()
graph({ storage: shared, vocab, plugins: [archetypes()] }).apply([
  { entity: { eid: 'kept' }, doc: { title: 'Kept' } },
])
let owned = storage(local, vocab)
owned.install()
let kept = owned.get(['kept'], ['doc'])[0].doc
let localMatch = () => catalog(local)({ all: ['doc'], none: [] })
let localId = localMatch()![0]

test('a single-owner install keeps rows and removes peer tracking cost', () => {
  equal(kept, { title: 'Kept' })
  equal(meta(local).get('table:archetype'), undefined)
  local.query({
    t: 'update',
    table: 'archetype',
    set: { tables: lit('["product"]') },
    where: eq(col('entity'), lit(localId)),
  })
  equal(localMatch(), [])
  // A leftover trigger would recreate the token on the mutation above.
  equal(meta(local).get('table:archetype'), undefined)
})

// The reader sees a peer's SQLite data_version rather than its AST writes.
// The fixture keeps its connection and installed schema outside timed cases.
let peer = () => {
  let db = mem()
  let store = storage({ ...db, file: true }, vocab)
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  g.apply([{ entity: { eid: 'one' }, doc: { title: 'One' } }])
  let version = 1
  let schema = 1
  let rows = 0
  let reader = {
    file: true,
    query: (s: Parameters<typeof db.query>[0]) => {
      if (s.t == 'pragma' && s.name == 'schema_version') {
        return [{ schema_version: schema }]
      }
      if (s.t == 'pragma' && s.name == 'data_version') {
        return [{ data_version: version }]
      }
      let out = db.query(s)
      rows += out.length
      return out
    },
  }
  let match = (all = ['doc']) => catalog(reader)({ all, none: [] })
  let first = match()
  rows = 0
  return {
    db,
    g,
    reader,
    match,
    first,
    rows: () => rows,
    commit: () => version++,
    schema: () => (schema++, version++),
  }
}

let unrelated = peer()
test('a catalog keeps its rows when a peer changes only component values', () => {
  unrelated.db.query({
    t: 'update',
    table: 'doc',
    set: { title: lit('Changed') },
  })
  unrelated.commit()
  equal(unrelated.match(), unrelated.first)
  // One table-token row, without returning any descriptors to the reader.
  equal(unrelated.rows(), 1)
})

let changed = peer()
let docId = changed.first![0]
test('a catalog observes a peer replacing a descriptor without a new id', () => {
  changed.db.query({
    t: 'update',
    table: 'archetype',
    set: { tables: lit('["product"]') },
    where: eq(col('entity'), lit(docId)),
  })
  changed.commit()
  equal(changed.match(), [])
  equal(changed.match(['product']), [docId])
})

let missing = peer()
test('a catalog without a table token still observes a peer changing its rows', () => {
  meta(missing.db).del('table:archetype')
  missing.commit()
  equal(missing.match(), missing.first)
  ok(missing.rows() > 1)
})

let untracked = peer()
untracked.db.query({
  t: 'drop',
  kind: 'trigger',
  name: 'archetype_version_update',
})
untracked.schema()
untracked.match()
test('a catalog whose tracking trigger was removed does not trust its old token', () => {
  untracked.db.query({
    t: 'update',
    table: 'archetype',
    set: { tables: lit('["product"]') },
    where: eq(col('entity'), lit(untracked.first![0])),
  })
  untracked.commit()
  equal(untracked.match(), [])
})

let undone = peer()
test('a descriptor read before rollback is replaced by the next mutation', () => {
  let { db, match } = undone
  db.query({ t: 'savepoint', name: 'undo' })
  db.query({
    t: 'update',
    table: 'archetype',
    set: { tables: lit('["product"]') },
    where: eq(col('entity'), lit(undone.first![0])),
  })
  undone.commit()
  equal(match(), [])
  db.query({ t: 'rollback', to: 'undo' })
  db.query({ t: 'release', name: 'undo' })
  db.query({
    t: 'update',
    table: 'archetype',
    set: { tables: lit('["doc"]') },
    where: eq(col('entity'), lit(undone.first![0])),
  })
  undone.commit()
  equal(match(), undone.first)
})

let clockFor = () => {
  let clock = mem()
  clock.query({
    t: 'create table',
    name: 'server_meta',
    cols: [{ name: 'k', pk: true }, { name: 'v' }],
  })
  clock.query({ t: 'create table', name: 'items', cols: [{ name: 'n' }] })
  for (let s of versioned('items')) clock.query(s)
  tableVersion(clock, 'items')
  return clock
}
let clock = clockFor()

test('table tokens hear insert, update and delete, and reinstall preserves them', () => {
  let before = tableVersion(clock, 'items')
  let moves = [
    insert('items', { n: 1 }),
    { t: 'update', table: 'items', set: { n: lit(2) } },
    { t: 'delete', from: 'items' },
  ] as const
  for (let s of moves) {
    clock.query(s)
    let next = tableVersion(clock, 'items')
    ok(next !== before)
    before = next
  }
  for (let s of versioned('items')) clock.query(s)
  equal(tableVersion(clock, 'items'), before)
  equal(clock.query(select({ cols: [col('n')], from: table('items') })), [])
})

let rolled = clockFor()
test('a table mutation after rollback never reuses the discarded token', () => {
  let before = tableVersion(rolled, 'items')
  rolled.query({ t: 'savepoint', name: 'undo' })
  rolled.query(insert('items', { n: 1 }))
  let discarded = tableVersion(rolled, 'items')
  rolled.query({ t: 'rollback', to: 'undo' })
  rolled.query({ t: 'release', name: 'undo' })
  equal(tableVersion(rolled, 'items'), before)
  rolled.query(insert('items', { n: 2 }))
  ok(tableVersion(rolled, 'items') !== discarded)
})
