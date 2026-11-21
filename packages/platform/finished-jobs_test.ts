import { graph, mint } from '@yaks/graph'
import { effectDoc } from '@yaks/effects/vocab'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { finishedJobs } from './finished-jobs.ts'

let sql = open(':memory:')
let vocab = loadVocab([effectDoc, {
  $defs: {
    note: { component: true, properties: { text: { type: 'string' } } },
  },
}])
let db = storage(sql, vocab)
db.install()
let g = graph({ storage: db, vocab })
let effect = { handler: 'mail', state: 'pending', at: '2026-11-20T01:00:00Z' }
let [gone, note, pending, done] = Array.from({ length: 4 }, () => mint())
await g.apply([
  { entity: { eid: gone }, effect },
  { entity: { eid: note }, effect, note: { text: 'Keep this' } },
  { entity: { eid: pending }, effect: { ...effect, next: effect.at } },
  { entity: { eid: done }, effect: { ...effect, state: 'done' } },
], { trusted: true })
await g.book([{ entity: { eid: pending }, effect: { next: null } }])
await g.apply([gone, note].map((eid) => ({ entity: { eid }, $delete: true })), {
  trusted: true,
})

test('finished job cleanup preserves mixed trash and standing work', async () => {
  let audit = await finishedJobs(sql, db, {})
  equal(audit.copies, 1)
  equal((await db.trash([gone])).length, 1)
  equal(await finishedJobs(sql, db, { erase: true }), audit)
  equal((await db.trash([gone])).length, 0)
  equal((await db.trash([note]))[0].bundles[0].note, { text: 'Keep this' })
  equal((await db.trash([pending])).length, 1)
  equal((await finishedJobs(sql, db, { erase: true, phase: 'done' })).jobs, 1)
  equal((await g.get([done])).length, 0)
  equal((await g.get([pending])).length, 1)
  equal((await finishedJobs(sql, db, { erase: true })).copies, 0)
})
