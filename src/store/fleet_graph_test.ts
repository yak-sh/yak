import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Bundle, token } from '@yaks/graph'
import { apply, fleetGraphOf, fleetVocabOf, readComp } from '../db.ts'
import { bareDb } from '../testdb.ts'
import { sha } from '../sha.ts'
import { asChanges } from './wire.ts'
import type { Sql } from './sql.ts'

let write = (db: Sql, bundles: Bundle[]) => {
  let out = fleetGraphOf(db).apply(bundles)
  assert(!(out instanceof Promise), 'fleet graph must remain synchronous')
  return out
}
let component = (out: Bundle[], eid: string, name: string) =>
  out.find((b) => b.entity.eid == eid)?.[name]
let raw = (db: Sql, sql: string) => db.prepare(sql).all()

Deno.test('fleet handle is per Sql and shares its vocabulary', () => {
  let db = bareDb()
  let g = fleetGraphOf(db)
  assertEquals(g, fleetGraphOf(db))
  assertEquals(g.vocab, fleetVocabOf(db))
  let other = bareDb()
  assert(g !== fleetGraphOf(other))
})

Deno.test('fleet CAS creates default both doc columns and echo whole writable rows', () => {
  let db = bareDb()
  let out = write(db, [
    { entity: { eid: 'title' }, doc: { title: 'Only title' }, task: {} },
    { entity: { eid: 'body' }, doc: { body: 'Only body 🦬' } },
    { entity: { eid: 'empty' }, doc: {} },
  ])
  for (
    let [eid, title, body] of [
      ['title', 'Only title', ''],
      ['body', '', 'Only body 🦬'],
      ['empty', '', ''],
    ]
  ) {
    assertEquals(component(out, eid, 'doc'), { title, body })
    assertEquals(component(out, eid, 'doc'), {
      title: readComp(db, eid, 'doc')?.title,
      body: readComp(db, eid, 'doc')?.body,
    })
  }
  assertEquals(component(out, 'title', 'task'), {})
  assertEquals(component(out, 'title', 'filed'), undefined)
  assertEquals(readComp(db, 'title', 'filed'), undefined)
  assertEquals(raw(db, 'select count(*) as n from blob_text'), [{ n: 2 }])
  assertEquals(raw(db, `select typeof(body) as type from doc`), [
    { type: 'integer' },
    { type: 'integer' },
    { type: 'integer' },
  ])
  let blob = out.find((b) => b.entity.eid == sha('Only body 🦬'))!
  assertEquals(blob.blob, {
    bytes: new TextEncoder().encode('Only body 🦬').length,
  })
  assertEquals(blob.entity, { eid: sha('Only body 🦬'), num: null })
  assertEquals(asChanges(blob).find((c) => c.name == 'entity'), {
    eid: sha('Only body 🦬'),
    name: 'entity',
    comp: blob.entity,
  })
})

Deno.test('fleet CAS patches echo exact text, deduplicate and preserve omitted columns', () => {
  let db = bareDb()
  write(db, [{ entity: { eid: 'p' }, doc: { title: 'First', body: 'shared' } }])
  let title = write(db, [{ entity: { eid: 'p' }, doc: { title: 'Second' } }])
  assertEquals(component(title, 'p', 'doc'), { title: 'Second' })
  assertEquals(readComp(db, 'p', 'doc')?.body, 'shared')
  let body = write(db, [{ entity: { eid: 'p' }, doc: { body: 'replacement' } }])
  assertEquals(component(body, 'p', 'doc'), { body: 'replacement' })
  assertEquals(readComp(db, 'p', 'doc')?.title, 'Second')
  let again = write(db, [{
    entity: { eid: 'q' },
    doc: { body: 'replacement' },
  }])
  assertEquals(again.filter((b) => b.blob).length, 0)
  assertEquals(raw(db, 'select count(*) as n from blob_text'), [{ n: 2 }])
  assertEquals(raw(db, 'select count(distinct body) as n from doc'), [{ n: 1 }])
  assertEquals(fleetGraphOf(db).rows('.doc.body=replacement'), [{ eid: 'p' }, {
    eid: 'q',
  }])
})

Deno.test('fleet $was reads hydrated text before defaults and CAS swaps', () => {
  let db = bareDb()
  write(db, [{ entity: { eid: 'p' }, doc: { body: 'old' } }])
  let out = write(db, [{
    entity: { eid: 'p' },
    doc: { body: 'new' },
    $was: { doc: { body: token('old') } },
  }])
  assertEquals(component(out, 'p', 'doc'), { body: 'new' })
  assertThrows(() =>
    write(db, [{
      entity: { eid: 'p' },
      doc: { body: 'stale' },
      $was: { doc: { body: token('old') } },
    }])
  )
  assertEquals(readComp(db, 'p', 'doc')?.body, 'new')
  assertEquals(
    raw(db, `select count(*) as n from entity where eid = '${sha('stale')}'`),
    [{ n: 0 }],
  )
  let fresh = write(db, [{
    entity: { eid: 'fresh' },
    doc: { title: 'Fresh' },
    $was: { doc: { body: null, title: null } },
  }])
  assertEquals(component(fresh, 'fresh', 'doc'), { title: 'Fresh', body: '' })
})

Deno.test('fleet CAS rollback removes bytes, blob entities, docs and numbers', () => {
  let db = bareDb()
  let g = fleetGraphOf(db)
  g.use({
    name: 'fail',
    hooks: {
      commit: () => {
        throw new Error('late refusal')
      },
    },
  })
  assertThrows(
    () => write(db, [{ entity: { eid: 'p' }, doc: { body: 'rollback' } }]),
    Error,
    'late refusal',
  )
  for (let table of ['entity', 'blob', 'blob_text', 'doc', 'created']) {
    assertEquals(raw(db, `select count(*) as n from ${table}`), [{ n: 0 }])
  }
})

Deno.test('fleet CAS ordered patches and drop/recreate return final defaults', () => {
  let db = bareDb()
  let out = write(db, [
    { entity: { eid: 'p' }, doc: { title: 'one', body: 'first' } },
    { entity: { eid: 'p' }, doc: { title: 'two' } },
    { entity: { eid: 'p' }, doc: null },
    { entity: { eid: 'p' }, doc: { body: 'last' } },
  ])
  assertEquals(component(out, 'p', 'doc'), { title: '', body: 'last' })
  assertEquals(readComp(db, 'p', 'doc')?.title, '')
})

Deno.test('fleet number allocation is requested, inline bodies are not CAS', () => {
  let db = bareDb()
  let out = write(db, [
    { entity: { eid: 'a' }, $num: true, doc: { title: 'numbered' } },
    { entity: { eid: 'edge' }, edge: { from: 'a', to: 'b' }, requires: {} },
    {
      entity: { eid: 'wake' },
      wake: { target: 'a', note: 'inline', at: '2026-09-09T00:00:00Z' },
    },
    {
      entity: { eid: 'b' },
      brief: { text: 'inline text' },
    },
  ])
  assertEquals(out.find((b) => b.entity.eid == 'edge')?.entity.num, null)
  assertEquals(out.find((b) => b.entity.eid == 'wake')?.entity.num, null)
  assertEquals(out.find((b) => b.entity.eid == 'a')?.entity.num, 1)
  assertEquals(out.find((b) => b.entity.eid == 'b')?.entity.num, null)
  let got = fleetGraphOf(db).read('.brief!') as Bundle[]
  assertEquals(component(got, 'b', 'brief'), {
    text: 'inline text',
  })
  assertEquals(raw(db, 'select count(*) as n from blob_text'), [{ n: 1 }])
})

Deno.test('fleet uses Sql transactions and holds a write lock before normalize', () => {
  let db = bareDb()
  let calls: boolean[] = []
  let proxy: Sql = {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => {
      assert(!/\b(begin|commit|rollback|savepoint|release)\b/i.test(sql))
      db.exec(sql)
    },
    transaction: (fn, immediate) => {
      calls.push(immediate === true)
      return db.transaction(fn, immediate)
    },
    get inTransaction() {
      return db.inTransaction
    },
    get lastInsertRowId() {
      return db.lastInsertRowId
    },
    get isOpen() {
      return db.isOpen
    },
    can: db.can,
    get version() {
      return db.version
    },
    set version(v) {
      db.version = v
    },
    afterCommit: (fn) => db.afterCommit(fn),
    close: () => db.close(),
  }
  let g = fleetGraphOf(proxy)
  g.use({
    name: 'lock-proof',
    hooks: {
      normalize: (b) => {
        assert(db.inTransaction)
        return b
      },
    },
  })
  write(proxy, [{ entity: { eid: 'p' }, doc: { body: 'nested' } }])
  assertEquals(calls, [true, true]) // no rollback-only mutation rehearsal
})

Deno.test('fleet CAS dry run returns exact defaults and numbers but keeps nothing', () => {
  let db = bareDb()
  let g = fleetGraphOf(db)
  let batch = [{ entity: { eid: 'p' }, doc: { title: 'dry' } }]
  let opts = { now: '2026-09-09T00:00:00.000Z' }
  let dry = g.apply(batch, { ...opts, check: true })
  assertEquals(raw(db, 'select count(*) as n from entity'), [{ n: 0 }])
  assertEquals(raw(db, 'select count(*) as n from blob_text'), [{ n: 0 }])
  assertEquals(g.apply(batch, opts), dry)
})

Deno.test('fleet CAS never materializes text for an already tombstoned doc', () => {
  let db = bareDb()
  write(db, [{ entity: { eid: 'p' }, doc: { body: 'before death' } }])
  write(db, [{ entity: { eid: 'p' }, tombstone: {} }])
  assertEquals(
    write(db, [{ entity: { eid: 'p' }, doc: { body: 'after death' } }]),
    [],
  )
  assertEquals(
    raw(
      db,
      `select count(*) as n from entity where eid = '${sha('after death')}'`,
    ),
    [{ n: 0 }],
  )
})

Deno.test('fleet CAS a SQL refusal rolls back materialized blobs as well as documents', () => {
  let db = bareDb()
  assertThrows(() =>
    write(db, [
      { entity: { eid: 'good' }, doc: { body: 'must roll back' } },
      { entity: { eid: 'bad' }, doc: { title: null, body: 'also rolls back' } },
    ])
  )
  for (let table of ['entity', 'blob', 'blob_text', 'doc']) {
    assertEquals(raw(db, `select count(*) as n from ${table}`), [{ n: 0 }])
  }
})

Deno.test('fleet births carrying entry stay unnumbered after their reference spines mint', () => {
  let db = bareDb()
  let out = fleetGraphOf(db).apply([
    { entity: { eid: 's' }, session: { id: 'test' } },
    {
      entity: { eid: 'e' },
      entry: { session: 's' },
      content: { body: 'line' },
    },
    { entity: { eid: 'p' }, doc: { title: 'after entry' } },
  ], { trusted: true }) as Bundle[]
  assertEquals(out.find((b) => b.entity.eid == 'e')?.entity.num, null)
  assertEquals(out.find((b) => b.entity.eid == 'p')?.entity.num, null)
})

Deno.test('live append numbers entries per session and rolls back sequence plus imports', () => {
  let db = bareDb()
  let ids = Object.fromEntries(
    ['s', 'a', 'b', 'c', 'fail', 'bad'].map((k) => [k, crypto.randomUUID()]),
  )
  apply(db, [{ eid: ids.s, name: 'session', comp: { id: 'append-test' } }])
  let append = (eid: string) => [
    { eid, name: 'entry', comp: { session: ids.s } },
    { eid, name: 'content', comp: { body: eid } },
  ]
  let imports = new Map([[ids.a, { source: '/tmp/fixture.jsonl', line: 1 }]])
  let out = apply(
    db,
    [...append(ids.a), ...append(ids.b)],
    undefined,
    undefined,
    imports,
  )
  assertEquals(out.filter((c) => c.name == 'entry').map((c) => c.comp?.seq), [
    1,
    2,
  ])
  assertEquals(readComp(db, ids.s, 'session')?.latest_seq, 2)
  assertEquals(readComp(db, ids.a, 'imported')?.line, 1)
  assertEquals(
    raw(db, `select num from entity where eid in ('${ids.a}', '${ids.b}')`),
    [{ num: null }, { num: null }],
  )
  assertThrows(() =>
    apply(db, [
      ...append(ids.fail),
      { eid: ids.bad, name: 'doc', comp: { title: null } },
    ])
  )
  assertEquals(readComp(db, ids.s, 'session')?.latest_seq, 2)
  assertEquals(readComp(db, ids.fail, 'entry'), undefined)
  apply(db, append(ids.c))
  assertEquals(readComp(db, ids.c, 'entry')?.seq, 3)
})
