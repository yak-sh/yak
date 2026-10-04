import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, graph, Refused, type Storage, type Tx } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc, archetypes, eidOf } from './mod.ts'

let fixture = (stamped = false) => {
  let vocab = loadVocab([archetypeDoc, {
    $defs: {
      note: {
        component: true,
        type: 'object',
        properties: { text: { type: 'string' } },
      },
      other: { component: true, type: 'object', properties: {} },
      ...(stamped
        ? {
          created: {
            component: true,
            type: 'object',
            properties: { at: { type: 'string', stamped: true } },
          },
        }
        : {}),
    },
  }])
  let storage = ram(vocab)
  let writes = 0, reads = 0, owners = 0
  let g = graph({
    vocab,
    storage: {
      ...storage,
      tx: (body) =>
        storage.tx((tx) =>
          body({
            ...tx,
            get: (eids, comps) => {
              reads++
              owners += eids.length
              return tx.get(eids, comps)
            },
            patch: (bundles) => {
              writes++
              return tx.patch(bundles)
            },
          })
        ),
    },
    plugins: [archetypes()],
  })
  return {
    g,
    storage,
    writes: () => writes,
    reads: () => reads,
    owners: () => owners,
  }
}

test('archetype admission gathers warmed descriptors with their owners', () => {
  let { g, reads } = fixture()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'kept' } }])
  let patch = [{ entity: { eid: 'a' }, note: { text: 'heard' } }]
  g.admit(patch)
  let before = reads()
  g.admit(patch)
  assertEquals(reads() - before, 1)
  assertEquals((g.get(['a']) as Bundle[])[0].note, { text: 'kept' })
})

test('archetype edits validate freshly gathered descriptors without rereading them', () => {
  let { g, reads } = fixture()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'kept' } }])
  // The owner and its descriptor are read again on every apply. A stable
  // shape needs that current validation, not another read of the descriptor.
  let before = reads()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'changed' } }])
  assertEquals(reads() - before, 1)
  assertEquals((g.get(['a']) as Bundle[])[0].note, { text: 'changed' })
})

test('same-shape edits read only their owner and current descriptor', () => {
  let { g, owners } = fixture()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'kept' } }])
  // The original creation needed the self-classifying descriptor as well.
  // Subsequent edits must still validate their current shape, but do not
  // need to read the creation's unrelated descriptor history.
  g.apply([{ entity: { eid: 'a' }, note: { text: 'first edit' } }])
  let before = owners()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'changed' } }])
  assertEquals(owners() - before, 2)
})

test('archetype read hints follow a foreign shape change and ignore old descriptors', () => {
  let { g, storage } = fixture()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'kept' } }])
  g.admit([{ entity: { eid: 'a' }, note: { text: 'heard' } }])
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: eidOf(['other']), archetype: eidOf(['archetype']) },
      archetype: { tables: '["other"]' },
    }, {
      entity: { eid: 'a', archetype: eidOf(['other']) },
      note: null,
      other: {},
    }, {
      entity: { eid: eidOf(['note']) },
      archetype: { tables: '[]' },
    }])
  )
  let patch = [{ entity: { eid: 'a' }, other: {} }]
  g.admit(patch)
  g.apply(patch, { check: true })
  assertEquals((g.get(['a']) as Bundle[])[0].note, undefined)
})

test('a warmed descriptor hint sees a descriptor deleted by another writer', () => {
  let { g, storage } = fixture()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'kept' } }])
  let patch = [{ entity: { eid: 'a' }, note: { text: 'heard' } }]
  g.admit(patch)
  storage.tx((tx) => tx.remove([{ eid: eidOf(['note']) }]))
  assertThrows(() => g.admit(patch), Refused, 'Missing archetype')
  assertThrows(
    () => g.apply(patch, { check: true }),
    Refused,
    'Missing archetype',
  )
})

test('archetype admission checks creation and edits without storage writes', () => {
  let { g, writes } = fixture()
  g.admit([{ entity: { eid: 'a' }, note: { text: 'new' } }])
  assertEquals(g.get(['a', eidOf(['note'])]), [])
  assertEquals(writes(), 0)
  g.apply([{ entity: { eid: 'a' }, note: { text: 'kept' } }])
  let before = writes()
  g.admit([{ entity: { eid: 'a' }, note: { text: 'heard' } }])
  assertEquals((g.get(['a']) as Bundle[])[0].note, { text: 'kept' })
  assertEquals(writes(), before)
})

test('a cached table set cannot hide an invalid stored archetype', () => {
  let { g, storage } = fixture()
  g.apply([{ entity: { eid: 'a' }, note: { text: 'kept' } }])
  g.admit([{ entity: { eid: 'a' }, note: { text: 'heard' } }])
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: eidOf(['note']) },
      archetype: { tables: '[]' },
    }])
  )
  let patch = [{ entity: { eid: 'a' }, note: { text: 'refused' } }]
  assertThrows(
    () => g.admit(patch),
    Refused,
    'Invalid stored archetype identity',
  )
  assertThrows(
    () => g.apply(patch, { check: true }),
    Refused,
    'Invalid stored archetype identity',
  )
  assertThrows(
    () => g.apply(patch),
    Refused,
    'Invalid stored archetype identity',
  )
  assertEquals((g.get(['a']) as Bundle[])[0].note, { text: 'kept' })
})

test('archetype admission preserves missing-descriptor and occupied-id refusals', () => {
  let { g, storage, writes } = fixture()
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'empty', archetype: eidOf([]) },
    }])
  )
  assertThrows(
    () => g.admit([{ entity: { eid: 'empty' }, note: {} }]),
    Refused,
    'Missing archetype',
  )
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: eidOf(['note']) },
      note: { text: 'occupied' },
    }])
  )
  assertThrows(
    () => g.admit([{ entity: { eid: 'new' }, note: {} }]),
    Refused,
    'Archetype identity is occupied',
  )
  assertEquals(g.get(['new']), [])
  assertEquals(writes(), 0)
})

test('archetype admission checks the descriptor needed after provenance stamps', () => {
  let { g, storage, writes } = fixture(true)
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: eidOf(['note', 'created']) },
      note: { text: 'occupied' },
    }])
  )
  let patch = [{ entity: { eid: 'new' }, note: {} }]
  assertThrows(
    () => g.admit(patch),
    Refused,
    'Archetype identity is occupied',
  )
  assertEquals(g.get(['new']), [])
  assertEquals(writes(), 0)
  assertThrows(
    () => g.apply(patch, { check: true }),
    Refused,
    'Archetype identity is occupied',
  )
})

for (let async of [false, true]) {
  test(`archetype: RAM plugin, async=${async}, transaction rollback`, async () => {
    let vocab = loadVocab([archetypeDoc, {
      $defs: {
        note: {
          component: true,
          type: 'object',
        },
      },
    }])
    let store = ram(vocab)
    let storage: Storage = async
      ? {
        ...store,
        tx: (body) =>
          store.tx((tx) => {
            let wrapped: Tx = {
              ...tx,
              get: (ids, comps) =>
                Promise.resolve().then(() => tx.get(ids, comps)),
              patch: (b) => Promise.resolve().then(() => tx.patch(b)),
              remove: (e) => Promise.resolve().then(() => tx.remove(e)),
            }
            return body(wrapped)
          }),
      }
      : store
    let g = graph({ storage, vocab, plugins: [archetypes()] })
    await g.apply([{ entity: { eid: 'a' }, note: {} }], { check: true })
    assertEquals(store.tx((tx) => tx.get(['a'])), [])
    await g.apply([{ entity: { eid: 'a' }, note: {} }])
    assertEquals(
      store.tx((tx) => tx.get(['a']))[0].entity.archetype,
      eidOf(['note']),
    )
    await g.apply([{ entity: { eid: 'a' }, note: null }])
    assertEquals(store.tx((tx) => tx.get(['a']))[0].entity.archetype, eidOf([]))
    await g.apply([{ entity: { eid: 'a' }, $delete: true }])
    assertEquals(
      store.tx((tx) => tx.get(['a']))[0].entity.archetype,
      eidOf(['tombstone']),
    )
  })
}
