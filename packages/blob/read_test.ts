// A component called doc is ordinary storage too. No adapter-owned doc_value
// view participates: the registry is the sole truth for a swapped read.
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { insert } from '@yaks/sql'
import { mem } from './testing.ts'
import { blobKeywords } from './keywords.ts'
import { blobRead, blobSchema } from './sqlite.ts'

Deno.test('doc predicates, paths, projections and bundles resolve the same blob', () => {
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
})
