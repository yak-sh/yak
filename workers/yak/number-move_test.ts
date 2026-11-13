import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { human } from '@yaks/id'
import { operatorMemory } from './operator-testing.ts'
import { NUMBERED, operatorVocab } from './operator-store.ts'
import { numberBackfill } from './number-move.ts'

let id = human(operatorVocab)
let receipts = new Map<string, string>()
let store = {
  ...operatorMemory(),
  marks: {
    get: (key: string) => receipts.get(key),
    set: (key: string, value: string) => void receipts.set(key, value),
  },
}
let { g } = store
let at = (day: number) => `2026-0${day}-01T00:00:00.000Z`
// Kept before the store numbered anything: made, then their numbers cleared.
let kept = async (rows: [string, string, number][]) => {
  let made = rows.map(([eid, comp, day]) => ({
    entity: { eid },
    [comp]: {},
    doc: { title: eid },
    created: { at: at(day) },
  }))
  await g.apply(made as Bundle[], { trusted: true, stamp: false })
  await g.apply(
    rows.map(([eid]) => ({ entity: { eid, num: null, prefix: null } })),
    { trusted: true, stamp: false },
  )
}
let ids = async (eids: string[]) =>
  (await g.get(eids)).map((b) => b.entity.num ? id(b) : null)

await kept([['t3', 'task', 3], ['t1', 'task', 1], ['g1', 'goal', 2]])
// Made since, numbered by its write.
let [fresh] = await g.apply([{ entity: { eid: 'new' }, task: {} }])

let n = fresh.entity.num!
let numbered = [`T-${n + 1}`, `T-${n + 2}`, 'V-1', `T-${n}`]

test('the kept rows have no number, and a new one has its own', async () => {
  equal(await ids(['t1', 't3', 'g1']), [null, null, null])
  equal(fresh.entity.prefix, 'T')
})

test('the pass numbers what was kept in the order it was made, after what is held', async () => {
  equal(await numberBackfill(store), false)
  equal(await ids(['t1', 't3', 'g1', 'new']), numbered)
  equal(receipts.get(NUMBERED), 'done')
})

test('a second run changes nothing', async () => {
  receipts.delete(NUMBERED)
  equal(await numberBackfill(store), false)
  equal(await ids(['t1', 't3', 'g1', 'new']), numbered)
})
