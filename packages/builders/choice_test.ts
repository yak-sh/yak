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
