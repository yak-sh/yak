// Notification occasions run through effect handlers in an in-memory graph.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle, Graph } from '@yaks/graph'
import { fixture } from './fixture_test.ts'
import { effects } from './effects.ts'
import { comp } from './model.ts'

let options = {
  to: crypto.randomUUID(),
  from: 'tracker@example.test',
  store: 'box',
  url: 'https://bugs.example.test',
}
let at = '2026-10-02T00:00:10Z'
let bug = (eid = crypto.randomUUID()): Bundle => ({
  entity: { eid },
  created: { at },
  doc: { title: `TypeError: broken ${eid}\nMore detail` },
  bug: {
    fault: eid,
    spot: 'file:///srv/app/src/run.ts:42 run',
  },
})
// Effect inputs have already been stamped. The declared-effects test covers
// intake and the generic mark rules; these cases exercise the handler's writes.
let put = (g: Graph, rows: Bundle[]) =>
  g.apply(rows, { trusted: true, stamp: false })
let replay = (g: Graph, row: Bundle, name = 'bug') =>
  effects({ graph: g }, options).bug_notify(
    {
      entity: row.entity,
      name,
      kind: 'created',
    },
    g,
    (rows) => put(g, rows),
  )
let letters = (g: Graph) => g.read('.mail *')

let check = (name: string, run: (g: Graph) => Promise<void>) => {
  let g = fixture()
  test(name, () => run(g))
}

check(
  'two bugs opening in one minute each get an immediate letter',
  async (g) => {
    let a = bug(), b = bug()
    await put(g, [a, b])
    await Promise.all([replay(g, a), replay(g, b)])
    let mail = await g.read('.mail')
    equal(mail.length, 2)
    equal(
      mail.map((m) => comp(m, 'mail').target).sort(),
      [a.entity.eid, b.entity.eid].sort(),
    )
  },
)

check(
  'a letter names its bug and carries its essentials and web link',
  async (g) => {
    let row = bug()
    row.bug = {
      ...comp(row, 'bug'),
      hits: 3,
      first: at,
      last: '2026-10-02T00:00:12Z',
    }
    await put(g, [row])
    await replay(g, row)
    let [letter] = await letters(g)
    equal(
      comp(letter, 'doc').title,
      `${row.entity.eid}: TypeError: broken ${row.entity.eid.slice(0, 8)}…`,
    )
    equal(
      comp(letter, 'doc').body,
      [
        comp(row, 'doc').title,
        '',
        'Where: app/src/run.ts:42 · run',
        'Hits: 3',
        `First seen: ${at}`,
        'Last seen: 2026-10-02T00:00:12Z',
        '',
        `[View ${row.entity.eid}](https://bugs.example.test/${row.entity.eid})`,
      ].join('\n'),
    )
    equal(comp(letter, 'mail').from, options.from)
    equal(comp(letter, 'deliver').to, options.to)
  },
)

check('replayed bug effects and wakes keep the same letter', async (g) => {
  let row = bug()
  await put(g, [row])
  await replay(g, row)
  let [letter] = await letters(g)
  await replay(g, row)
  await put(g, [{ entity: row.entity, fired: {} }])
  await replay(g, row)
  await replay(g, row, 'fired')
  equal((await letters(g)).map((m) => m.entity.eid), [letter.entity.eid])
})

check('only a delivered letter marks its own bug notified', async (g) => {
  let a = bug(), b = bug()
  await put(g, [a, b])
  await replay(g, a)
  let mail = await letters(g)
  let letter = mail.find((m) => comp(m, 'mail').target == a.entity.eid)!
  equal((await g.get([a.entity.eid, b.entity.eid])).map((b) => !!b.notified), [
    false,
    false,
  ])
  await put(g, [{ entity: letter.entity, delivered: {} }])
  await replay(g, letter)
  equal((await g.get([a.entity.eid, b.entity.eid])).map((b) => !!b.notified), [
    true,
    false,
  ])
})

check(
  'an earlier occasion delivered after regression cannot notify the regression',
  async (g) => {
    let row = bug()
    await put(g, [row])
    await replay(g, row)
    let [old] = await letters(g)
    await put(g, [{
      entity: row.entity,
      regressed: { at: '2026-10-02T00:00:20Z' },
    }, { entity: old.entity, delivered: {} }])
    await replay(g, old)
    ok(!(await g.get([row.entity.eid]))[0].notified)
  },
)

test('archived bugs never notify, repeats do not create another letter', async () => {
  let g = fixture(), row = bug()
  await put(g, [{ ...row, archived: {} }])
  await replay(g, row)
  equal((await letters(g)).length, 0)
  let pushed = 0
  let stream = fixture({
    notify: () => {
      pushed++
    },
  })
  await put(stream, [{ ...row, archived: {} }])
  equal(pushed, 0)
})

test('space openings still use their notify stream', async () => {
  let pushed: Bundle[] = []
  let g = fixture({
    notify: (bugs) => {
      pushed.push(...bugs)
    },
  })
  let row = bug()
  await put(g, [row])
  equal(pushed.map((b) => b.entity.eid), [row.entity.eid])
  equal((await letters(g)).length, 0)
  ok(!(await g.get([row.entity.eid]))[0].notified)
})
