// A component called doc is ordinary storage too. No adapter-owned doc_value
// view participates: the registry is the sole truth for a swapped read.
import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { match, reads } from '@yaks/graph'
import { insert, val } from '@yaks/sql'
import { blog, fixture, mem } from './testing.ts'
import { blobKeywords } from './keywords.ts'
import { blobRead, blobSchema, sqliteBlobs } from './sqlite.ts'
import { open } from '@yaks/sqlite/db'
import { graph } from '@yaks/graph'
import { blobs } from './plugin.ts'

test('doc predicates, paths, projections and bundles resolve the same blob', () => {
  let vocab = loadVocab({
    $defs: {
      entity: {
        component: true,
        properties: { num: { type: 'number', stamped: true } },
      },
      doc: {
        component: true,
        properties: {
          title: { type: 'string' },
          body: { type: 'string', store: 'blob' },
        },
      },
      note: {
        component: true,
        properties: { target: { type: 'string', ref: 'doc', death: 'detach' } },
      },
    },
  }, [blobKeywords])
  let driver = mem()
  let store = storage(driver, vocab, { derived: blobRead(vocab) })
  store.install()
  driver.query({ t: 'drop', kind: 'view', name: 'doc_value', ifExists: true })
  for (let s of blobSchema()) driver.query(s)
  for (
    let s of [
      insert('entity', { id: 1, eid: 'd', num: 1 }, {
        id: 2,
        eid: 'n',
        num: 2,
      }),
      insert('blob_text', { sha: 'address', value: 'resolved prose' }),
      insert('doc', { entity: 1, title: 'A title', body: 'address' }),
      insert('note', { entity: 2, target: 1 }),
    ]
  ) driver.query(s)
  assertEquals(store.rows('.doc.title~=title'), [{ eid: 'd' }])
  assertEquals(store.rows('.doc.body~=prose'), [{ eid: 'd' }])
  assertEquals(store.rows('.note.target.doc.body~=prose'), [{ eid: 'n' }])
  assertEquals(store.rows('.doc.body~=address'), [])
  assertEquals(store.rows('.doc .fields=doc.body'), [{
    eid: 'd',
    'doc.body': 'resolved prose',
  }])
  assertEquals(store.read('.doc.body~=prose')[0].doc, {
    title: 'A title',
    body: 'resolved prose',
  })
  let flat = match('$d .doc, doc.body=$description')
  let nested = match(
    '$n .note, note.target=$d; [$d .doc, doc.body=$description]',
  )
  let found = store.tx((tx) =>
    tx.bindings([flat, nested], [], [
      ...new Set([...reads(flat, vocab), ...reads(nested, vocab)]),
    ])
  )
  assertEquals(found[0], [{
    entities: ['d'],
    vars: { d: 'd', description: 'resolved prose' },
  }])
  assertEquals(found[1], [{
    entities: ['n'],
    vars: { n: 'n', d: 'd' },
    collections: [{
      vars: ['d', 'description'],
      entityVars: ['d'],
      members: [{
        entities: ['d'],
        vars: { n: 'n', d: 'd', description: 'resolved prose' },
      }],
    }],
  }])
})

test('admission reuses immutable content reads until their authoritative SQL state changes', () => {
  let f = fixture()
  f.g.apply([{ entity: { eid: 'p' }, post: { title: 'Hello', body: 'first' } }])
  let get = () => f.db.tx((tx) => tx.get(['p']), { admission: true })[0]
  assertEquals(get().post?.body, 'first')
  let query = f.driver.query, reads = 0
  f.driver.query = (stmt) => {
    if (stmt.t == 'select' || stmt.t == 'raw') reads++
    return query(stmt)
  }
  get()
  get()
  assertEquals(reads, 0)
  f.g.apply([{ entity: { eid: 'p' }, post: { body: 'second' } }])
  assertEquals(get().post?.body, 'second')
})

test('immutable admission content follows raw blob changes and rollback', () => {
  let f = fixture()
  f.g.apply([{ entity: { eid: 'p' }, post: { body: 'first' } }])
  let get = () => f.db.tx((tx) => tx.get(['p']), { admission: true })[0]
  get()
  f.driver.query({
    t: 'update',
    table: 'blob_text',
    set: { value: val('raw') },
  })
  assertEquals(get().post?.body, 'raw')
  assertThrows(() =>
    f.db.tx(() => {
      f.driver.query({
        t: 'update',
        table: 'blob_text',
        set: { value: val('temporary') },
      })
      assertEquals(get().post?.body, 'temporary')
      throw new Error('rollback')
    })
  )
  assertEquals(get().post?.body, 'raw')
})

test('immutable admission content observes blob commits by another file connection', () => {
  let dir = Deno.makeTempDir({ prefix: 'T-65691-blob-' })
  let a = open(`${dir}/data.db`), b = open(`${dir}/data.db`)
  try {
    let s = storage(a, blog, { derived: blobRead(blog) })
    s.install()
    for (let stmt of blobSchema()) a.query(stmt)
    let g = graph({
      storage: s,
      vocab: blog,
      plugins: [blobs(blog, sqliteBlobs(a))],
    })
    g.apply([{ entity: { eid: 'p' }, post: { body: 'first' } }])
    let get = () => s.tx((tx) => tx.get(['p']), { admission: true })[0]
    assertEquals(get().post?.body, 'first')
    b.query({
      t: 'update',
      table: 'blob_text',
      set: { value: val('other connection') },
    })
    assertEquals(get().post?.body, 'other connection')
  } finally {
    a.close()
    b.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
