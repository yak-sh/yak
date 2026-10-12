// Whole-component blob reads start with the component row already in hand.
// Count workerd's billed rows while that read resolves the stored address.
import { driver, type DurableStorage } from '@yaks/durable-object'
import {
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'
import { val } from '@yaks/sql'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'

export let blobGatherCost = (db: DurableStorage) => {
  let counting = false, read = 0, written = 0
  let sql = driver(db, (s) => {
    if (!counting) return
    read += s.rowsRead
    written += s.rowsWritten
  })
  let vocab = loadVocab({
    $defs: {
      post: {
        component: true,
        properties: {
          title: { type: 'string' },
          body: { type: 'string', store: 'blob' },
        },
      },
    },
  }, [blobKeywords])
  let store = storage(sql, vocab, { derived: blobRead(vocab) })
  store.install()
  for (let stmt of blobSchema()) sql.query(stmt)
  let g = graph({
    vocab,
    storage: store,
    plugins: [blobs(vocab, sqliteBlobs(sql))],
  })
  g.apply([{
    entity: { eid: 'post' },
    post: { title: 'Hello', body: 'prose' },
  }])
  // A raw change invalidates the authoritative memo, as a different writer's
  // change would, so the measured getter must gather the current stored row.
  sql.query({
    t: 'update',
    table: 'blob_text',
    set: { value: val('current prose') },
  })
  counting = true
  let rows = store.get(['post'], ['post'])
  counting = false
  return { rows, read, written }
}
