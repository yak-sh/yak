// The complete README scenarios, with each private store prepared during module
// load. Opening a schema is fixture work; the cases time the graph operation
// or answer they promise, retaining every assertion in the printed examples.

import { equal, test, throws } from '@yaks/testing'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    post: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        published: { type: 'boolean' },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})

let overview = open(':memory:')
let overviewStore = storage(overview, vocab)
overviewStore.install()
let overviewGraph = graph({ storage: overviewStore, vocab })
await overviewGraph.apply([
  { entity: { eid: 'kate' }, doc: { title: 'Kate' } },
  {
    entity: { eid: 'p1' },
    doc: { title: 'Hello world', body: 'first post' },
    post: { published: true, author: 'kate' },
  },
])
// Warm immutable read plans; the answers still come from the store under test.
overviewGraph.read('.post.published=1')
overviewGraph.read('.post')
overviewStore.tx((tx) => tx.doom(['kate']))
test('README graph selects a published post', () =>
  equal(overviewGraph.read('.post.published=1').map((b) => b.entity.eid), [
    'p1',
  ]))
test('README graph reads a post reference', () =>
  equal(overviewGraph.read('.post')[0].post, {
    published: true,
    author: 'kate',
  }))
test('README storage plans a detached reference', () =>
  equal(overviewStore.tx((tx) => tx.doom(['kate'])).loose, [{
    eid: 'p1',
    comp: 'post',
    prop: 'author',
  }]))
// Deletion planning has its own graph contracts; this example's check reads
// the detached row. Give it an independent committed fixture so the earlier
// reference checks do not depend on a test's execution order.
let detached = open(':memory:')
let detachedStore = storage(detached, vocab)
let detachedGraph = graph({ storage: detachedStore, vocab })
await detachedGraph.apply([
  { entity: { eid: 'kate' }, doc: { title: 'Kate' } },
  {
    entity: { eid: 'p1' },
    doc: { title: 'Hello world', body: 'first post' },
    post: { published: true, author: 'kate' },
  },
])
await detachedGraph.apply([{ entity: { eid: 'kate' }, $delete: true }])
detachedGraph.read('.post')
test('README graph reads a post after its author is deleted', () => {
  equal(detachedGraph.read('.post')[0].post, { published: true })
  detached.close()
  overview.close()
})

let writes = open(':memory:')
let writeStore = storage(writes, loadVocab(docDoc))
writeStore.tx((tx) =>
  tx.patch([
    { entity: { eid: 'p1' }, doc: { title: 'Hello', body: 'First' } },
  ])
)
test('README patch clears a property without clearing its sibling', () => {
  writeStore.tx((tx) =>
    tx.patch([{ entity: { eid: 'p1' }, doc: { title: null } }])
  )
  equal(writeStore.get(['p1'])[0].doc, { body: 'First' })
})
// Compile the removal and read paths against a rollback before timing them.
try {
  writeStore.tx((tx) => {
    tx.patch([{ entity: { eid: 'p1' }, doc: null }])
    throw new Error('abort')
  })
} catch { /* the fixture deliberately leaves its document intact */ }
writeStore.read('.doc')
test('README failed transaction restores a removed component', async () => {
  await throws(() =>
    writeStore.tx((tx) => {
      tx.patch([{ entity: { eid: 'p1' }, doc: null }])
      throw new Error('abort')
    })
  )
  equal(writeStore.read('.doc').length, 1)
})
test('README removing an entity preserves its tombstone', () => {
  writeStore.tx((tx) => tx.remove([{ eid: 'p1' }]))
  equal(writeStore.read('.doc'), [])
  equal('tombstone' in writeStore.get(['p1'])[0], true)
})
let revived = open(':memory:')
let revivedStore = storage(revived, loadVocab(docDoc))
revivedStore.tx((tx) => {
  tx.patch([{ entity: { eid: 'p1' }, doc: { body: 'First' } }])
  tx.remove([{ eid: 'p1' }])
  tx.revive(['p1'])
  tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Again' } }])
})
revivedStore.get(['p1'])
test('README reviving an entity keeps only its newly written properties', () => {
  equal(revivedStore.get(['p1'])[0].doc, { title: 'Again' })
  revived.close()
  writes.close()
})

let reading = open(':memory:')
let readStore = storage(reading, loadVocab(docDoc))
readStore.tx((tx) =>
  tx.patch([
    { entity: { eid: 'a' }, doc: { title: 'A' } },
    { entity: { eid: 'b' }, doc: { title: 'B' } },
  ])
)
readStore.rows('.doc .count')
readStore.rows('.doc.title=A .fields=doc.title')
readStore.get(['b'], ['doc'])
reading.query(readStore.screen('.doc.title=A')!)
test('README storage counts matching documents', () =>
  equal(readStore.rows('.doc .count'), [{ value: '', n: 2 }]))
test('README storage projects a selected document title', () =>
  equal(readStore.rows('.doc.title=A .fields=doc.title'), [{
    eid: 'a',
    'doc.title': 'A',
  }]))
test('README storage reads only a requested component', () =>
  equal(readStore.get(['b'], ['doc'])[0].doc, { title: 'B' }))
test('README storage screen selects the matching row', () => {
  equal(reading.query(readStore.screen('.doc.title=A')!).length, 1)
  reading.close()
})
