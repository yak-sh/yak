// A store's wake-ups, subscriptions and runs kept in the Operator's old words
// are given @yaks/wake's beside them, and a firing the old code owed and
// never ran is owed again as `wake_run`; until then the store fires nothing.
import { equal, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { operatorMemory } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { wakeBackfill, WAKES } from './wake-move.ts'

let receipts = new Map<string, string>()
let store = {
  ...operatorMemory(),
  marks: {
    get: (key: string) => receipts.get(key),
    set: (key: string, value: string) => void receipts.set(key, value),
    del: (key: string) => void receipts.delete(key),
  },
}
let { g } = store
let [space, person] = [crypto.randomUUID(), crypto.randomUUID()]
let ask = { space, person, administrative: false }
let due = new Date(Date.now() - 60_000).toISOString()
let fired = '2026-11-13T12:00:00.000Z'
let kept: Bundle[] = [
  {
    entity: { eid: 'board' },
    wake: { at: due, every: '0 7 * * * America/Detroit' },
    operator_ask: { ...ask, say: '', helper: 'The daily pass.' },
  },
  {
    entity: { eid: 'mom' },
    wake: { at: due },
    operator_ask: { ...ask, say: 'Remind them to call Mom.' },
    fired: { at: fired },
  },
  {
    entity: { eid: 'meetings' },
    wake: { at: due, every: '1m' },
    operator_ask: { ...ask, say: 'Tell them.' },
    operator_subscription: { query: '.doc', mine: true, seen: { a: 'b' } },
  },
  {
    entity: { eid: 'run' },
    session: {},
    operator_session: { space, person },
    operator_work: { schedule: 'board', at: fired, error: 'it broke' },
  },
]
await g.apply(kept, { trusted: true })
// A firing the old code owed and had not run.
await g.apply([{
  entity: { eid: 'owed' },
  effect: {
    handler: 'operator_fired',
    target: 'mom',
    kind: 'changed',
    state: 'pending',
    at: fired,
  },
}], { trusted: true, stamp: false })

let words = async (): Promise<unknown[]> =>
  (await g.get(['board', 'mom', 'meetings', 'run'])).map((b) => ({
    wake: b.wake && { ...b.wake as Comp, at: undefined },
    watch: b.watch,
    occurrence: b.occurrence,
  }))
receipts.set(WAKES, '')
let quiet = await drain(store)
let unfired = (await g.get(['board']))[0].fired
let more = await wakeBackfill(store)
let moved = await words()
let [run] = await g.get(['owed'])
receipts.delete(WAKES)
await wakeBackfill(store)
let again = await words()

test('no wake fires while the store’s wakes are in the old words', () => {
  equal(unfired, undefined)
  equal(quiet! > Date.now(), true)
})

test('each row takes the package’s words, and the pass is done', () => {
  let every = '0 7 * * * America/Detroit'
  equal(more, false)
  equal(receipts.get(WAKES), 'done')
  equal(moved, [
    {
      wake: { at: undefined, every, for: person, brief: 'The daily pass.' },
      watch: undefined,
      occurrence: undefined,
    },
    {
      wake: { at: undefined, for: person, note: 'Remind them to call Mom.' },
      watch: undefined,
      occurrence: undefined,
    },
    {
      wake: { at: undefined, every: '1m', for: person, note: 'Tell them.' },
      watch: { query: '.doc', local: true, seen: { a: 'b' } },
      occurrence: undefined,
    },
    {
      wake: undefined,
      watch: undefined,
      occurrence: { wake: 'board', at: fired, error: 'it broke' },
    },
  ])
})

test('a firing owed to the old code is owed as wake_run, and a second pass changes nothing', () => {
  equal((run.effect as Comp).handler, 'wake_run')
  equal((run.effect as Comp).state, 'pending')
  equal(again, moved)
})
