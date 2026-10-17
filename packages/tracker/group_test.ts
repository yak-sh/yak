import { equal, ok, test } from '@yaks/testing'
import { type Bundle, Stale } from '@yaks/graph'
import { fixture } from './fixture_test.ts'
import { group, grouped, retained, trim } from './group.ts'
import { capture } from './report.ts'
import { comp } from './model.ts'
import { runs } from './tools.ts'
import { valueIn } from '@yaks/tools/value'

let app = crypto.randomUUID(), second = crypto.randomUUID()
let person = crypto.randomUUID(), other = crypto.randomUUID()
let a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40)

let occurrence = (
  id: string,
  commit = a,
  scope = app,
  by = person,
): Bundle =>
  capture(new TypeError('missing row 42'), {
    sink: () => {},
    eid: id,
    at: `2026-10-02T00:00:${id.padStart(2, '0')}Z`,
    commit,
    during: { app: scope, kind: 'call' },
    tags: { user_id: by },
  })[0]
let put = async (g: ReturnType<typeof fixture>, row: Bundle) => {
  await g.apply([row], { trusted: true })
  await group(g, row.entity.eid)
}
let bugs = (g: ReturnType<typeof fixture>) => g.read('.bug *')

let imported = (id: string, marks: Record<string, object> = {}): Bundle => {
  let row = occurrence(id)
  return {
    ...row,
    error: { ...comp(row, 'error'), tags: { migration: 'exception/1' } },
    ...marks,
  }
}
let historical: Record<string, { at: string }> = {
  archived: { at: '2026-09-01T00:00:00Z' },
  resolved: { at: '2026-09-02T00:00:00Z' },
  notified: { at: '2026-09-03T00:00:00Z' },
}
let historyGroup = async (...rows: Bundle[]) => {
  let g = fixture()
  for (let row of rows) await put(g, row)
  return (await bugs(g))[0]
}

let allMarked = await historyGroup(
  imported('1', historical),
  imported('2', historical),
)
test('imported marked samples preserve their group lifecycle and notification history', () => {
  for (let name of Object.keys(historical)) {
    equal(allMarked[name], historical[name])
  }
  equal(comp(allMarked, 'bug').status, 'archived')
  equal(comp(allMarked, 'bug').hits, 2)
})

for (let order of ['marked-first', 'active-first']) {
  let rows = [imported('1', historical), imported('2')]
  let mixed = await historyGroup(
    ...(order == 'marked-first' ? rows : rows.toReversed()),
  )
  test(`an active imported sample keeps its group active (${order})`, () => {
    for (let name of Object.keys(historical)) equal(mixed[name], undefined)
    equal(comp(mixed, 'bug').status, 'open')
    equal(comp(mixed, 'bug').hits, 2)
  })
}

let existingLifecycle = await (async () => {
  let g = fixture()
  await put(g, occurrence('1'))
  let [bug] = await bugs(g)
  let marks = {
    resolved: { at: '2026-10-10T00:00:00Z' },
    notified: { at: '2026-10-10T00:00:00Z' },
  }
  await g.apply([{ entity: bug.entity, ...marks }], { trusted: true })
  let old = imported('2', historical)
  old.error = { ...comp(old, 'error'), commit: b }
  await put(g, old)
  return { bug: (await bugs(g))[0], marks }
})()
test('importing old samples never changes an existing reporter group lifecycle', () => {
  let { bug, marks } = existingLifecycle
  equal(bug.resolved, marks.resolved)
  equal(bug.notified, marks.notified)
  equal(bug.archived, undefined)
  equal(bug.regressed, undefined)
  equal(comp(bug, 'bug').hits, 2)
})

let existingOpen = await historyGroup(
  occurrence('1'),
  imported('2', historical),
)
test('marked imported samples cannot close an existing open reporter group', () => {
  for (let name of Object.keys(historical)) equal(existingOpen[name], undefined)
  equal(comp(existingOpen, 'bug').status, 'open')
})

let later: Record<string, { at: string }> = {
  archived: { at: '2026-10-10T00:00:00Z' },
  resolved: { at: '2026-10-11T00:00:00Z' },
  notified: { at: '2026-10-12T00:00:00Z' },
}
let latestHistorical = await historyGroup(
  imported('1', historical),
  imported('2', later),
)
test('fully marked imported groups keep the latest historical stamps', () => {
  for (let name of Object.keys(later)) {
    equal(latestHistorical[name], later[name])
  }
})

let laterAction = await (async () => {
  let g = fixture()
  await put(g, imported('1', historical))
  let [bug] = await bugs(g)
  await g.apply([{ entity: bug.entity, ...later }], { trusted: true })
  await put(g, imported('2'))
  return (await bugs(g))[0]
})()
test('later group actions outrank lifecycle inherited from imported samples', () => {
  for (let name of Object.keys(later)) equal(laterAction[name], later[name])
})

let markRace = await (async () => {
  let g = fixture()
  await put(g, imported('1', historical))
  let row = imported('2')
  await g.apply([row], { trusted: true })
  let [bug] = await bugs(g)
  let before = await g.read('.error.bug=' + bug.entity.eid + ' *')
  await g.apply([{
    entity: bug.entity,
    archived: later.archived,
    notified: later.notified,
  }], { trusted: true })
  let refused = false
  try {
    await g.apply(grouped(row, bug, before), { trusted: true })
  } catch (error) {
    refused = error instanceof Stale
  }
  await group(g, row.entity.eid)
  return { refused, bug: (await bugs(g))[0] }
})()
test('an action racing imported grouping is guarded and preserved on retry', () => {
  equal(markRace.refused, true)
  equal(markRace.bug.archived, later.archived)
  equal(markRace.bug.notified, later.notified)
  equal(markRace.bug.resolved, undefined)
  equal(comp(markRace.bug, 'bug').hits, 2)
})

test('grouping counts once, scopes apps, and reads people and status', async () => {
  let g = fixture()
  await put(g, occurrence('1'))
  await put(g, occurrence('2'))
  await group(g, '2')
  let [bug] = await bugs(g)
  equal(comp(bug, 'bug').hits, 2)
  equal(comp(bug, 'doc').title, 'TypeError: missing row 42')
  ok(!('title' in comp(bug, 'bug')))
  equal(comp(bug, 'bug').people, 1)
  equal(comp(bug, 'bug').status, 'open')
  await put(g, occurrence('3', a, app, other))
  equal(comp((await bugs(g))[0], 'bug').people, 2)
  await put(g, occurrence('4', a, second))
  equal((await bugs(g)).length, 2)
})

test('old code counts without reopening; a new commit regresses once', async () => {
  let g = fixture()
  await put(g, occurrence('1'))
  let [bug] = await bugs(g)
  await g.apply([{
    entity: bug.entity,
    resolved: { at: '2026-10-02T00:00:01Z' },
    notified: {},
  }], {
    trusted: true,
  })
  await put(g, occurrence('2'))
  equal(comp((await bugs(g))[0], 'bug').status, 'resolved')
  await put(g, occurrence('3', b))
  let [back] = await bugs(g)
  equal(comp(back, 'bug').status, 'open')
  equal(comp(back, 'regressed').error, '3')
  ok(!back.notified && !back.resolved)
  await g.apply([{ entity: back.entity, archived: {} }], { trusted: true })
  await put(g, occurrence('4', c))
  equal(comp((await bugs(g))[0], 'bug').status, 'archived')
})

for (let kind of ['commit', 'version']) {
  for (
    let [when, at] of [
      ['before', '2026-10-02T00:00:01Z'],
      ['equal', '2026-10-02T00:00:02Z'],
      ['after', '2026-10-02T00:00:03Z'],
    ]
  ) {
    let g = fixture()
    let first = occurrence('1')
    let row = occurrence('2', b)
    row.error = { ...comp(row, 'error'), at, hits: 7 }
    if (kind == 'version') {
      first.error = { ...comp(first, 'error'), commit: null, version: 1 }
      row.error = { ...comp(row, 'error'), commit: null, version: 2 }
    }
    await put(g, first)
    let [bug] = await bugs(g)
    let marks = {
      resolved: { at: '2026-10-02T00:00:02Z' },
      notified: { at: '2026-10-02T00:00:02Z' },
    }
    await g.apply([{ entity: bug.entity, ...marks }], { trusted: true })
    await put(g, row)
    await group(g, row.entity.eid)
    let [result] = await bugs(g)
    let [linked] = await g.get([row.entity.eid])
    test(`an unseen ${kind} ${when} resolution counts and only later occurrences reopen`, () => {
      equal(comp(result, 'bug').hits, 8)
      equal(comp(linked, 'error').bug, bug.entity.eid)
      equal(comp(result, 'bug').last, at)
      if (when == 'after') {
        equal(result.resolved, undefined)
        equal(result.notified, undefined)
        equal(comp(result, 'regressed').error, row.entity.eid)
        equal(comp(result, 'bug').status, 'open')
      } else {
        equal(result.resolved, marks.resolved)
        equal(result.notified, marks.notified)
        equal(result.regressed, undefined)
        equal(comp(result, 'bug').status, 'resolved')
      }
    })
  }
}

test('retention preserves the first per commit and historical hit count', async () => {
  let g = fixture()
  for (let i = 1; i <= 6; i++) {
    await put(g, occurrence(String(i), i == 3 ? b : a))
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
  equal((valueIn(await tools.bug_show(call, g))?.rows as Bundle[]).length, 2)
  await g.apply(await tools.bug_resolve(call, g), { trusted: true })
  equal(valueIn(await tools.bug_list({ entity: { eid: 'list' } }, g))?.rows, [])
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
