import { equal, test, throws } from '@yaks/testing'
import { bare, fixture } from './fixture_test.ts'
import { group } from './group.ts'
import { comp, type Desk } from './model.ts'
import { consolidation, regroup, survivor } from './merge.ts'
import { bug, runs } from './tools.ts'

let ids = Array.from({ length: 6 }, () => crypto.randomUUID())
let seed = (g: Desk) =>
  g.apply(
    ids.slice(0, 3).flatMap((eid, i) => [
      {
        entity: { eid },
        doc: { title: 'loop' },
        bug: {
          fault: `:loop@at elapsed (kernel-${
            ['CMPk0h6p', 'DU4oOsHq', 'B9ofLTzq'][i]
          }.js#)`,
          spot: `kernel-${
            ['CMPk0h6p', 'DU4oOsHq', 'B9ofLTzq'][i]
          }.js:82 elapsed`,
          hits: i + 10,
          first: `2026-10-30T15:0${i}:00Z`,
          last: `2026-10-30T15:0${i}:30Z`,
        },
        notified: { at: '2026-10-30T15:00:01Z' },
      },
      {
        entity: { eid: ids[i + 3] },
        error: { at: `2026-10-30T15:0${i}:00Z`, bug: eid, message: 'loop' },
        exception: { stack: `at elapsed (kernel-${i}.js:82)` },
      },
    ]),
    { trusted: true },
  )
let g = fixture()
await seed(g)
let repaired = await regroup(g)
let again = await regroup(g)
test('regroup preserves historical hits, capture bytes, marks and issued addresses', async () => {
  equal(repaired, { bugs: 1, merged: 2 })
  equal(again, { bugs: 0, merged: 0 })
  let bugs = await g.read('.bug *')
  equal(bugs.length, 1)
  equal(bugs[0].entity.eid, ids[0])
  equal(comp(bugs[0], 'bug').hits, 34)
  equal(comp(bugs[0], 'bug').last, '2026-10-30T16:00:00Z')
  equal(comp(bugs[0], 'bug').spot, 'kernel.js:82 elapsed')
  equal(comp(bugs[0], 'notified').at, '2026-10-30T15:00:01Z')
  equal((await survivor(g, ids[2]))?.entity.eid, ids[0])
  let errors = await g.read(`.error.bug=${ids[0]} *`)
  equal(errors.length, 4)
  equal(
    comp(errors.find((r) => r.entity.eid == ids[5]), 'exception').stack,
    'at elapsed (kernel-2.js:82)',
  )
  equal((await bug(g, ids[2]))[0].entity.eid, ids[0])
  await g.apply(
    await runs().bug_archive({
      entity: { eid: crypto.randomUUID() },
      call: { args: { bug: ids[1] } },
    }, g),
    { trusted: true },
  )
  equal(!!(await survivor(g, ids[0]))?.archived, true)
})
let fresh = crypto.randomUUID()
await g.apply([{
  entity: { eid: fresh },
  error: {
    at: '2026-10-30T16:00:00Z',
    fault: ':loop@at elapsed (kernel-NEWHash1.js#)',
  },
}], { trusted: true })
await group(g, fresh)
test('a later deploy joins the existing survivor without another bug', async () => {
  equal(comp((await g.get([fresh]))[0], 'error').bug, ids[0])
  equal((await g.read('.bug *')).length, 1)
  equal(comp((await g.get([ids[0]]))[0], 'bug').hits, 34)
})
let conflicting = bare()
await seed(conflicting)
let before = await conflicting.read('.bug *')
let stale = consolidation(before, [])
await conflicting.apply([{ entity: { eid: ids[1] }, bug: { hits: 500 } }])
test('consolidation refuses a concurrent counter change without moving any group', async () => {
  await throws(() => conflicting.apply(stale), /moved since/i)
  equal((await conflicting.read('.bug *')).length, 3)
})
test('consolidation keeps an open survivor and leaves resolved history closed', () => {
  let closed = {
    ...before[0],
    resolved: { at: '2026-10-30T15:01:00Z', cause: 'fixed', recur: 'fixed' },
  }
  let patch = consolidation([closed, before[1]], [])
  equal(patch[0].entity.eid, ids[1])
  equal(patch.some((r) => r.resolved === null), false)
  equal(consolidation([closed], [])[0].resolved, undefined)
})
