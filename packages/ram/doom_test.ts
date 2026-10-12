import { equal, test, throws } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from './mod.ts'

let vocab = loadVocab({
  $defs: Object.fromEntries(
    ['cascade', 'detach', 'release', 'keep'].map((death) => [death, {
      component: true,
      properties: { to: { type: 'string', ref: 'entity', death } },
    }]),
  ),
})

test('deletion indexes close cycles, clear surviving references and follow rollback', async () => {
  let s = ram(vocab, { number: true })
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'a' }, cascade: { to: 'c' } },
      { entity: { eid: 'b' }, cascade: { to: 'a' } },
      { entity: { eid: 'c' }, cascade: { to: 'b' } },
      {
        entity: { eid: 'survivor' },
        detach: { to: 'b' },
        release: { to: 'c' },
        keep: { to: 'a' },
      },
    ])
  )
  let closed = {
    gone: [
      { eid: 'a', depth: 0 },
      { eid: 'b', depth: 1 },
      { eid: 'c', depth: 2 },
    ],
    loose: [
      { eid: 'survivor', comp: 'release', prop: 'to' },
      { eid: 'survivor', comp: 'detach', prop: 'to' },
    ],
  }
  equal(s.tx((tx) => tx.doom(['a'])), closed)
  await throws(() =>
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'b' }, cascade: { to: null } }])
      equal(tx.doom(['a']), { gone: [{ eid: 'a', depth: 0 }], loose: [] })
      throw Error('rollback')
    }), 'rollback')
  equal(s.tx((tx) => tx.doom(['a'])), closed)
})

let computed = loadVocab({
  $defs: {
    node: {
      component: true,
      properties: {
        parent: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
        },
      },
    },
  },
})

test('a cascade follows computed references instead of stored index values', () => {
  let s = ram(computed, {
    computed: {
      'node.parent': (b) => b.entity.eid == 'child' ? 'root' : null,
    },
  })
  let g = graph({ vocab: computed, storage: s })
  g.apply([
    { entity: { eid: 'root' }, node: {} },
    { entity: { eid: 'child' }, node: {} },
  ])
  g.apply([{ entity: { eid: 'root' }, $delete: true }])
  equal(s.get(['root', 'child']).map((b) => b.tombstone), [{}, {}])
})
