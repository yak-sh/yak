import { equal, test } from '@yaks/testing'
import { ids, store } from './testing.ts'

test('session fixture stores keep their rows and numbering isolated', async () => {
  let first = store()
  let second = store()
  await first.tx((tx) => {
    tx.patch([{ entity: { eid: ids.p1 }, page: { title: 'Changed' } }])
    return tx.remove([{ eid: ids.p2 }])
  })
  for (let fresh of [second, store()]) {
    let rows = await fresh.get([ids.p1, ids.p2])
    equal(rows.map((b) => [b.entity.num, b.page]), [
      [5, { title: 'Lemon cake', by: ids.ada }],
      [6, { title: 'Potluck', by: ids.bo }],
    ])
    await fresh.tx((tx) => tx.patch([{ entity: { eid: 'next' }, page: {} }]))
    equal((await fresh.get(['next']))[0].entity.num, 7)
  }
})
