import { type Comp, graph } from '@yaks/graph'
import { pooledBlog } from '../packages/effects/testing.ts'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { equal, test } from '@yaks/testing'
import { migrateDone } from './migrate-done-effects.ts'

let fixture = () => {
  let sql = open(':memory:')
  let db = storage(sql, pooledBlog)
  db.install()
  return { sql, g: graph({ storage: db, vocab: pooledBlog }) }
}
let quiet = () => {}

test('done migration deletes whole runs, preserves pending and failed, and resumes empty', async () => {
  let { sql, g } = fixture()
  try {
    await g.apply([
      { entity: { eid: 'target' }, post: { title: 'Target survives' } },
      {
        entity: { eid: 'done' },
        effect: { state: 'done', target: 'target', attempts: 1 },
        post: { title: 'Success removes everything on its run' },
      },
      { entity: { eid: 'pending' }, effect: { state: 'pending', attempts: 2 } },
      { entity: { eid: 'failed' }, effect: { state: 'failed', error: 'keep' } },
    ], { trusted: true })
    let preserved = await g.get(['target', 'pending', 'failed'])
    let [held] = await g.get(['done'])
    let result = await migrateDone(sql, g, 1, quiet)
    equal(result.before, { done: 1, pending: 1, failed: 1 })
    equal(result.after, { done: 0, pending: 1, failed: 1 })
    equal(result.deleted, 1)
    equal(await g.get(['done']), [{ entity: held.entity, tombstone: {} }])
    equal(await g.get(['target', 'pending', 'failed']), preserved)
    equal((await migrateDone(sql, g, 1, quiet)).deleted, 0)
    equal(await g.get(['target', 'pending', 'failed']), preserved)
  } finally {
    sql.close()
  }
})

for (
  let patch of [
    { state: 'pending' },
    { lease_token: 'new-claim' },
    { attempts: 2 },
  ]
) {
  test(`done migration continues after raced ${Object.keys(patch)[0]} and resumes refused rows`, async () => {
    let { sql, g } = fixture()
    try {
      await g.apply(
        ['race', 'same-batch', 'later'].map((eid) => ({
          entity: { eid },
          effect: { state: 'done', attempts: 1, lease_token: 'old-claim' },
        })),
        { trusted: true },
      )
      let raced = false
      let sizes: number[] = []
      let door = {
        ...g,
        apply: async (...args: Parameters<typeof g.apply>) => {
          sizes.push(args[0].length)
          if (!raced) {
            raced = true
            await g.apply([{
              entity: { eid: 'race' },
              effect: patch,
            }], { trusted: true })
          }
          return await g.apply(...args)
        },
      }
      let first = await migrateDone(sql, door, 2, quiet)
      equal(first.refused, 1)
      equal(first.deleted, 1)
      equal(sizes, [2, 1])
      equal(((await g.get(['same-batch']))[0].effect as Comp)?.state, 'done')
      equal((await g.get(['later']))[0].tombstone, {})
      let second = await migrateDone(sql, g, 2, quiet)
      equal(second.deleted, patch.state ? 1 : 2)
      equal(second.after.done, 0)
      if (patch.state) {
        equal(((await g.get(['race']))[0].effect as Comp)?.state, 'pending')
      }
    } finally {
      sql.close()
    }
  })
}
