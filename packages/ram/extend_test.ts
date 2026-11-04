import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ram } from './mod.ts'

let doc: VocabDoc = {
  $defs: {
    old: {
      component: true,
      properties: { key: { type: 'string', unique: true } },
    },
  },
}
let was = loadVocab(doc)
let next = loadVocab([doc, {
  $defs: {
    fresh: {
      component: true,
      status: { done: 'done', default: 'open' },
      properties: {
        key: { type: 'string', unique: true },
        bytes: { type: 'string', contentEncoding: 'base64' },
        target: { type: 'string', ref: 'old', death: 'cascade' },
      },
    },
    done: { component: true },
  },
}])
let s = ram(was)
s.tx((tx) => tx.patch([{ entity: { eid: 'old' }, old: { key: 'kept' } }]))
let kept = s.get(['old'])[0]
let grew = s.extend(next)
let retained = s.get(['old'])[0] === kept
s.tx((tx) =>
  tx.patch([{
    entity: { eid: 'fresh' },
    fresh: { key: 'one', bytes: new Uint8Array([1, 2]), target: 'old' },
  }])
)

test('RAM growth retains existing rows and computes new statuses', () => {
  equal(grew, true)
  equal(retained, true)
  let value = s.get(['fresh'])[0].fresh as { bytes: Uint8Array; status: string }
  equal(value.status, 'open')
})

test('RAM copies newly declared binary values on read', () => {
  let value = s.get(['fresh'])[0].fresh as { bytes: Uint8Array }
  value.bytes[0] = 9
  equal(
    (s.get(['fresh'])[0].fresh as typeof value).bytes,
    new Uint8Array([1, 2]),
  )
})

test('RAM growth enforces new unique indexes and keeps existing ones', () => {
  assertThrows(() =>
    s.tx((tx) =>
      tx.patch([{ entity: { eid: 'duplicate' }, fresh: { key: 'one' } }])
    )
  )
})

test('RAM growth follows new status rungs and cascade references', () => {
  assertThrows(() =>
    s.tx((tx) =>
      tx.patch([{ entity: { eid: 'duplicate' }, old: { key: 'kept' } }])
    )
  )
  s.tx((tx) => tx.patch([{ entity: { eid: 'fresh' }, done: {} }]))
  equal(s.read('.fresh.status=done')[0].entity.eid, 'fresh')
  equal(s.tx((tx) => tx.doom(['old']))?.gone.map((b) => b.eid), [
    'old',
    'fresh',
  ])
})

let unindexed = ram(loadVocab({ $defs: {} }))
unindexed.extend(next)
unindexed.tx((tx) =>
  tx.patch([{ entity: { eid: 'first' }, fresh: { key: 'one' } }])
)
test('RAM growth enables uniqueness on a store that had no unique indexes', () => {
  assertThrows(() =>
    unindexed.tx((tx) =>
      tx.patch([{ entity: { eid: 'second' }, fresh: { key: 'one' } }])
    )
  )
})

test('RAM refuses incompatible growth without changing storage policy', () => {
  let unchanged = ram(was)
  equal(
    unchanged.extend(loadVocab({ $defs: { old: { component: true } } })),
    false,
  )
  equal(unchanged.worn('old', 'key'), true)
  equal(unchanged.worn('fresh', 'key'), false)
})
