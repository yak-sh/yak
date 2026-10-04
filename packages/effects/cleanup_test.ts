// The legacy cleanup keeps human content and failures and refuses stale state.
import { equal, test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { pooledBlog } from './testing.ts'
import { cleanupDone } from './cleanup.ts'

test('legacy cleanup is bounded, guarded and leaves failures and human data', async () => {
  let sql = open(':memory:')
  let db = storage(sql, pooledBlog)
  db.install()
  let g = graph({ storage: db, vocab: pooledBlog })
  try {
    await g.apply([
      { entity: { eid: 'done' }, effect: { state: 'done' } },
      {
        entity: { eid: 'human' },
        effect: { state: 'done' },
        post: { title: 'Keep this' },
      },
      {
        entity: { eid: 'failure' },
        effect: { state: 'failed', error: 'keep failure' },
      },
      { entity: { eid: 'pending' }, effect: { state: 'pending' } },
    ], { trusted: true })
    let size = 0, raced = false
    let door = {
      ...g,
      apply: async (
        bs: Parameters<typeof g.apply>[0],
        o?: Parameters<typeof g.apply>[1],
      ) => {
        size = Math.max(size, bs.length)
        if (!raced) {
          raced = true
          await g.apply([{
            entity: { eid: 'done' },
            effect: { state: 'pending' },
          }], { trusted: true })
        }
        return await g.apply(bs, o)
      },
    }
    equal(await cleanupDone(door, 1), 1)
    equal(size, 1)
    equal(await cleanupDone(g), 0)
    equal(((await g.get(['human']))[0].post as Comp)?.title, 'Keep this')
    equal(((await g.get(['failure']))[0].effect as Comp)?.error, 'keep failure')
    equal(((await g.get(['done']))[0].effect as Comp)?.state, 'pending')
  } finally {
    sql.close()
  }
})
