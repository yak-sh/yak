import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { as, col, fn, type History, NOW, select, table } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { open } from './db.ts'
import { branch, moded, storage } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    dep: {
      component: true,
      properties: {
        source: { type: 'string', index: true },
        rank: { type: 'number', index: true },
      },
    },
  },
}])
let history: History = {
  clock: {
    t: 'insert',
    into: 'clock',
    cols: ['at'],
    rows: [[NOW]],
    returning: [col('id')],
  },
  tip: select({ cols: [as(fn('max', col('id')), 'id')], from: table('clock') }),
}

// A file that still owes one index, as a store building its indexes later
// does: a branch's tables are relations, so no index of theirs is named.
let path = `${Deno.makeTempDirSync({ prefix: 'mode-' })}/graph.db`
let d = open(path)
d.query({
  t: 'create table',
  name: 'clock',
  cols: [{ name: 'id', type: 'integer', pk: true }, {
    name: 'at',
    type: 'text',
  }],
})
let store = storage(d, vocab, { history })
store.install()
await graph({ storage: store, vocab }).apply([
  { entity: { eid: 'a' }, dep: { source: 'component:doc', rank: 1 } },
])
d.query({ t: 'drop', kind: 'index', name: 'dep_rank' })
let on = graph({
  storage: moded(open(path), vocab, { history }, branch(d, history)),
  vocab,
})

test('a branch over a file owing an index seeks none of its own', async () =>
  equal(
    (await on.read('.dep.source="component:doc"')).map((b) => b.entity.eid),
    ['a'],
  ))

test('branches read and write versions in a UUID store', () => {
  let v = loadVocab({
    $defs: {
      memo: {
        $id: `urn:uuid:${crypto.randomUUID()}`,
        component: true,
        properties: {
          title: { $id: `urn:uuid:${crypto.randomUUID()}`, type: 'string' },
        },
      },
    },
  })
  let db = open(':memory:')
  using _close = { [Symbol.dispose]: () => db.close() }
  db.query({
    t: 'create table',
    name: 'clock',
    cols: [{ name: 'id', type: 'integer', pk: true }, {
      name: 'at',
      type: 'text',
    }],
  })
  let live = storage(db, v, { history })
  live.install()
  let patch = (title: string) => [{ entity: { eid: 'a' }, memo: { title } }]
  live.tx((tx) => tx.patch(patch('before')))
  let mode = branch(db, history)
  live.tx((tx) => tx.patch(patch('main')))
  let side = moded(db, v, { history }, mode)
  equal(side.read('.memo.title=before')[0]?.memo, { title: 'before' })
  side.tx((tx) => tx.patch(patch('branch')))
  equal(side.read('.memo.title=branch')[0]?.memo, { title: 'branch' })
  equal(live.read('.memo.title=main')[0]?.memo, { title: 'main' })
})
