import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { choices } from './choice.ts'

test('choice admission enforces one output per slot without moving the prior choice', () => {
  let vocab = loadVocab([{
    $defs: {
      built: {
        component: true,
        type: 'object',
        properties: { build: { type: 'string' }, slot: { type: 'string' } },
      },
      chosen: { component: true, type: 'object' },
    },
  }])
  let storage = ram(vocab)
  let writes = 0
  let g = graph({
    vocab,
    storage: {
      ...storage,
      tx: (body) =>
        storage.tx((tx) =>
          body({
            ...tx,
            patch: (bundles) => {
              writes++
              return tx.patch(bundles)
            },
          })
        ),
    },
    plugins: [choices()],
  })
  g.apply(['old', 'new'].map((eid) => ({
    entity: { eid },
    built: { build: 'b', slot: 's' },
    ...eid == 'old' ? { chosen: {} } : {},
  })))
  writes = 0
  assertEquals(
    (g.admit([{ entity: { eid: 'new' }, chosen: {} }]) as Bundle[]).map((
      b,
    ) => [b.entity.eid, b.chosen]),
    [['old', null], ['new', {}]],
  )
  assertEquals((g.get(['old']) as Bundle[])[0].chosen, {})
  assertEquals((g.get(['new']) as Bundle[])[0].chosen, undefined)
  assertEquals(writes, 0)
  assertThrows(
    () =>
      g.admit(['old', 'new'].map((eid) => ({ entity: { eid }, chosen: {} }))),
    Refused,
    'choose only one take',
  )
})

test('peer admission does not reconcile durable builders or write a rolled-back rehearsal', async () => {
  let { workshop } = await import('./testing.ts')
  let { storage } = await import('@yaks/sqlite')
  let { mem } = await import('../sqlite/testing.ts')
  let vocab = workshop([{
    $defs: {
      position: {
        component: true,
        type: 'object',
        sync: 'peers',
        properties: { x: { type: 'number' } },
      },
    },
  }])
  let store = storage(mem(), vocab)
  store.install()
  let writes = 0, builderReads = 0
  let g = graph({
    vocab,
    storage: {
      ...store,
      tx: (body) =>
        store.tx((tx) =>
          body({
            ...tx,
            patch: (bundles) => {
              writes++
              return tx.patch(bundles)
            },
            read: (q, opts) => {
              if (JSON.stringify(q).includes('builder_dep')) builderReads++
              return tx.read(q, opts)
            },
          })
        ),
    },
    plugins: [choices()],
  })
  await g.apply([{ entity: { eid: 'hero' }, position: { x: 0 } }])
  writes = builderReads = 0
  let accepted = await g.admit([{
    entity: { eid: 'hero' },
    position: { x: 1 },
  }])
  assertEquals(accepted.find((b) => b.entity.eid == 'hero')?.position, { x: 1 })
  assertEquals(writes, 0)
  assertEquals(builderReads, 0)
  assertEquals((await g.get(['hero']))[0].position, { x: 0 })
  await g.apply([{ entity: { eid: 'hero' }, position: { x: 2 } }])
  assertEquals(builderReads > 0, true)
  assertEquals((await g.get(['hero']))[0].position, { x: 2 })
})
