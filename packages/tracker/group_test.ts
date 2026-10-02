import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { fixture } from './fixture_test.ts'
import { group, retained, trim } from './group.ts'
import { capture } from './report.ts'
import { comp } from './model.ts'
import { runs } from './tools.ts'

let occurrence = (
  id: string,
  commit = 'a',
  app = 'app',
  by = 'person',
): Bundle =>
  capture(new TypeError('missing row 42'), {
    sink: () => {},
    eid: id,
    at: `2026-10-02T00:00:${id.padStart(2, '0')}Z`,
    commit,
    during: { app, kind: 'call' },
    actor: { by },
  })[0]
let put = async (g: ReturnType<typeof fixture>, row: Bundle) => {
  await g.apply([row], { trusted: true })
  await group(g, row.entity.eid)
}
let bugs = (g: ReturnType<typeof fixture>) => g.read('.bug *')

test('grouping counts once, scopes apps, and reads people and status', async () => {
  let g = fixture()
  await put(g, occurrence('1'))
  await put(g, occurrence('2'))
  await group(g, '2')
  let [bug] = await bugs(g)
  equal(comp(bug, 'bug').hits, 2)
  equal(comp(bug, 'bug').people, 1)
  equal(comp(bug, 'bug').status, 'open')
  await put(g, occurrence('3', 'a', 'app', 'other'))
  equal(comp((await bugs(g))[0], 'bug').people, 2)
  await put(g, occurrence('4', 'a', 'second'))
  equal((await bugs(g)).length, 2)
})

test('old code counts without reopening; a new commit regresses once', async () => {
  let g = fixture()
  await put(g, occurrence('1'))
  let [bug] = await bugs(g)
  await g.apply([{ entity: bug.entity, resolved: {}, notified: {} }], {
    trusted: true,
  })
  await put(g, occurrence('2'))
  equal(comp((await bugs(g))[0], 'bug').status, 'resolved')
  await put(g, occurrence('3', 'b'))
  let [back] = await bugs(g)
  equal(comp(back, 'bug').status, 'open')
  equal(comp(back, 'regressed').error, '3')
  ok(!back.notified && !back.resolved)
  await g.apply([{ entity: back.entity, archived: {} }], { trusted: true })
  await put(g, occurrence('4', 'c'))
  equal(comp((await bugs(g))[0], 'bug').status, 'archived')
})

test('retention preserves the first per commit and historical hit count', async () => {
  let g = fixture()
  for (let i = 1; i <= 6; i++) {
    await put(g, occurrence(String(i), i == 3 ? 'b' : 'a'))
  }
  let [bug] = await bugs(g)
  await trim(g, bug.entity.eid, 2)
  let rows = await g.read('.error *')
  equal(rows.map((b) => b.entity.eid).sort(), ['1', '3', '5', '6'])
  equal(comp((await bugs(g))[0], 'bug').hits, 6)
  equal(retained(rows, 2).size, 4)
})

test('bug tools mark resolve/archive and show retained occurrences', async () => {
  let g = fixture()
  await put(g, occurrence('1'))
  let [bug] = await bugs(g)
  let call: Bundle = {
    entity: { eid: 'call' },
    call: { args: { bug: bug.entity.eid } },
  }
  let tools = runs()
  equal((await tools.bug_show(call, g)).length, 2)
  await g.apply(await tools.bug_resolve(call, g), { trusted: true })
  equal((await tools.bug_list({ entity: { eid: 'list' } }, g)).length, 0)
  await g.apply(await tools.bug_archive(call, g), { trusted: true })
  equal(comp((await bugs(g))[0], 'bug').status, 'archived')
})

test('concurrent grouper snapshots cannot lose a hit or count an eid twice', async () => {
  let g = fixture()
  await put(g, occurrence('1'))
  let a = occurrence('2')
  let b = occurrence('3')
  await g.apply([a, b], { trusted: true })
  let [bug] = await bugs(g)
  let before = await g.read('.error.bug=' + bug.entity.eid + ' *')
  let { grouped } = await import('./group.ts')
  await g.apply(grouped(a, bug, before), { trusted: true })
  let failed = false
  try {
    await g.apply(grouped(b, bug, before), { trusted: true })
  } catch {
    failed = true
  }
  ok(failed)
  await group(g, '3')
  await group(g, '2')
  equal(comp((await bugs(g))[0], 'bug').hits, 3)
})
