// A component called doc is ordinary storage too. No adapter-owned doc_value
// view participates: the registry is the sole truth for a swapped read.
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from './harness.ts'
import { blobKeywords } from './keywords.ts'
import { blobRead, blobSchema } from './sqlite.ts'

Deno.test('doc predicates, paths, projections and bundles resolve the same blob', () => {
  let vocab = loadVocab({
    $defs: {
      entity: { properties: { num: { type: 'number', stamped: true } } },
      doc: {
        properties: {
          title: { type: 'string' },
          body: { type: 'string', store: 'blob' },
        },
      },
      note: { properties: { target: { ref: 'doc', death: 'detach' } } },
    },
  }, [blobKeywords])
  let driver = mem()
  let store = storage(driver, vocab, { derived: blobRead(vocab) })
  store.install()
  driver.exec('drop view if exists doc_value')
  for (let sql of blobSchema()) driver.exec(sql)
  driver.exec(`
    insert into entity(id, eid, num) values (1, 'd', 1), (2, 'n', 2);
    insert into blob_text(sha, value) values ('address', 'resolved prose');
    insert into doc(entity, title, body) values (1, 'A title', 'address');
    insert into note(entity, target) values (2, 1);
  `)
  assertEquals(store.rows('.doc.title~=title'), [{ eid: 'd' }])
  assertEquals(store.rows('.doc.body~=prose'), [{ eid: 'd' }])
  assertEquals(store.rows('.note.target.doc.body~=prose'), [{ eid: 'n' }])
  assertEquals(store.rows('.doc.body~=address'), [])
  assertEquals(store.rows('.doc! .fields=doc.body'), [{
    eid: 'd',
    'doc.body': 'resolved prose',
  }])
  assertEquals(store.read('.doc.body~=prose')[0].doc, {
    title: 'A title',
    body: 'resolved prose',
  })
})
