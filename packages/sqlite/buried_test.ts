// The graves a retention sweep may prune: old tombstones nothing names, walked
// a page at a time, with a pruned grave still marking where the walk resumes.
import { equal, test } from '@yaks/testing'
import { type Bundle, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { col, eq, select, table, val } from '@yaks/sql'
import { storage } from './mod.ts'
import { mem } from './testing.ts'

let vocab = loadVocab([{
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    mark: {
      component: true,
      properties: { by: { type: 'string', ref: 'entity', death: 'keep' } },
    },
  },
}])
let later = new Date(Date.now() + 60_000).toISOString()
let earlier = new Date(Date.now() - 60_000).toISOString()
let dead = ['g1', 'g2', 'g3', 'g4', 'g5']
let all = (eids: string[]): Bundle[] =>
  eids.map((eid) => ({ entity: { eid }, doc: { title: eid } }))

let driver = mem()
for (
  let [name, store] of [
    ['sqlite', storage(driver, vocab)],
    ['ram', ram(vocab)],
  ] as const
) {
  store.install()
  let g = graph({ storage: store as Storage, vocab })
  g.apply([...all(dead), { entity: { eid: 'marker' }, mark: { by: 'g2' } }])
  g.apply(dead.map((eid) => ({ entity: { eid }, $delete: true })))
  if (name == 'sqlite') {
    // A table another package made, keyed to identities as the journal's are.
    driver.query({
      t: 'create table',
      name: 'trail',
      cols: [{
        name: 'target',
        type: 'integer',
        ref: { table: 'entity', cols: ['id'] },
      }],
    })
    driver.query({
      t: 'insert',
      into: 'trail',
      cols: ['target'],
      q: select({
        cols: [col('id')],
        from: table('entity'),
        where: eq(col('eid'), val('g4')),
      }),
    })
  }
  let named = name == 'sqlite' ? ['g2', 'g4'] : ['g2']
  // Prepare the statements outside the cases.
  store.buried(later, { limit: 2 })
  store.tx((tx) => tx.prune(['absent']))

  test(`${name}: a grave laid after the moment is not offered`, () => {
    equal(store.buried(earlier, { limit: 10 }), { eids: [] })
  })

  test(`${name}: graves nothing names come a page at a time, resuming past pruned ones`, async () => {
    let first = await g.outside.buried!(later, { limit: 2 })
    store.tx((tx) => tx.prune(first.eids))
    let rest = await g.outside.buried!(later, { after: first.next, limit: 9 })
    equal(
      [...first.eids, ...rest.eids].sort(),
      dead.filter((eid) => !named.includes(eid)),
    )
    equal(rest.next, undefined)
  })
}
