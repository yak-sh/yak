import { type Bundle, type Graph } from '@yaks/graph'
import { isPromise } from '@yaks/fp'
import { equal, test } from '@yaks/testing'
import { purged } from './purge.ts'
import { address, type Blobs, encode } from './store.ts'

let fixture = (
  retained: string[] = [],
  journal: string[] = [],
  deferred = false,
) => {
  let values = new Map(
    ['alone', 'shared'].map((text) => [address(text), encode(text)]),
  )
  let store: Blobs = {
    has: (sha) => values.has(sha),
    get: (sha) => values.get(sha),
    put: (sha, bytes) => void values.set(sha, bytes),
    drop: (shas) => shas.forEach((sha) => values.delete(sha)),
  }
  let graph = {
    storage: { retained: () => retained },
    plugins: [{
      name: 'history',
      retained: () => deferred ? Promise.resolve(journal) : journal,
    }],
  } as unknown as Graph
  let removed: Bundle[] = [{
    entity: { eid: 'forgotten' },
    retired: { nested: [address('alone'), address('shared')] },
  }]
  return { store, graph, removed }
}

let alone = fixture()
test('an explicit purge releases pooled content held only in the removed snapshots', async () => {
  await purged(alone.store, [])(alone.graph, alone.removed)
  equal(await alone.store.has(address('alone')), false)
})

for (let representation of ['shared', address('shared')]) {
  let live = fixture([representation])
  test(`an explicit purge keeps content still held as ${representation}`, async () => {
    await purged(live.store, [])(live.graph, live.removed)
    equal(await live.store.has(address('shared')), true)
    equal(await live.store.has(address('alone')), false)
  })
}

let historical = fixture([], ['shared'], true)
test('an explicit purge keeps content still held in a plugin historical record', async () => {
  await purged(historical.store, [])(historical.graph, historical.removed)
  equal(await historical.store.has(address('shared')), true)
  equal(await historical.store.has(address('alone')), false)
})

let unknown = fixture()
delete unknown.graph.storage.retained
test('an explicit purge keeps bytes when storage cannot account for retained copies', async () => {
  await purged(unknown.store, [])(unknown.graph, unknown.removed)
  equal(await unknown.store.has(address('alone')), true)
})

let synchronous = fixture()
test('a synchronous pool purge stays inside synchronous storage transactions', () => {
  equal(
    isPromise(
      purged(synchronous.store, [])(synchronous.graph, synchronous.removed),
    ),
    false,
  )
  equal(synchronous.store.has(address('alone')), false)
})
