// Notification occasions run through their handlers over a bare store: the
// handlers' own reads and writes, admitted and guarded as the graph would,
// without the pipeline around them. That the declared effects run these
// handlers is ./effects_test.ts's.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { bare } from './fixture_test.ts'
import {
  type Desk,
  follow as followed,
  notify,
  type Options,
} from './effects.ts'
import { comp, str } from './model.ts'

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
let put = (g: Desk, rows: Bundle[]) =>
  g.apply(rows, { trusted: true, stamp: false })
let replay = (g: Desk, row: Bundle, more: Options = {}) =>
  notify(g, row.entity.eid, { ...options, ...more })
let follow = (g: Desk, row: Bundle) => followed(g, row.entity.eid, options)
let letters = (g: Desk) => g.read('.mail *')

let check = (name: string, run: (g: Desk) => Promise<void>) =>
  test(name, () => run(bare()))

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
    let { title, body } = comp(letter, 'doc') as Record<string, string>
    ok(
      title.endsWith(
        `${row.entity.eid}: TypeError: broken ${row.entity.eid.slice(0, 8)}…`,
      ),
    )
    for (
      let said of [
        comp(row, 'doc').title as string,
        'app/src/run.ts:42 · run',
        '3 hits',
        '2026-10-02 00:00:12 UTC',
        `(https://bugs.example.test/${row.entity.eid})`,
      ]
    ) ok(body.includes(said), said)
    equal(comp(letter, 'mail').from, options.from)
    equal(comp(letter, 'deliver').to, options.to)
  },
)

// An app's occurrence, as yaks.app reports one from a test account's space.
let occurrence = (row: Bundle, request: string): Bundle[] => [{
  entity: { eid: crypto.randomUUID() },
  error: {
    at,
    bug: row.entity.eid,
    commit: '2e13aff3a1b2c3d4e5f60718293a4b5c6d7e8f90',
    tags: {
      script: 't1_drills',
      space: 't1',
      app: 'drills',
      version: '3',
      entrypoint: 'browser report',
      account: 'test',
    },
  },
  during: { request },
}, {
  entity: { eid: request },
  request: {
    method: 'POST',
    url: 'https://t1.yaks.app/drills/api/query',
    status: 500,
  },
}]

check(
  'a letter says where it ran, whom it reached and the request that failed',
  async (g) => {
    let row = bug()
    await put(g, [row, ...occurrence(row, crypto.randomUUID())])
    await replay(g, row)
    let [letter] = await letters(g)
    let { title, body } = comp(letter, 'doc') as Record<string, string>
    ok(title.startsWith('[yaks.app t1/drills test account] '), title)
    for (
      let said of [
        't1/drills · v3 · browser report',
        'test accounts only',
        'POST https://t1.yaks.app/drills/api/query → 500',
        '2e13aff',
      ]
    ) ok(body.includes(said), said)
  },
)

check('a regression and a resolve answer the opening letter', async (g) => {
  let row = bug()
  await put(g, [row])
  await replay(g, row)
  let [opening] = await letters(g)
  await put(g, [{
    entity: row.entity,
    resolved: { at: '2026-10-02T00:01:00Z' },
  }])
  await follow(g, row)
  await follow(g, row)
  await put(g, [{
    entity: row.entity,
    resolved: null,
    regressed: { at: '2026-10-02T00:02:00Z' },
  }])
  await replay(g, row)
  let later = (await letters(g)).filter((m) =>
    m.entity.eid != opening.entity.eid
  )
  equal(later.length, 2)
  for (let m of later) {
    equal(comp(m, 'mail').reply_to, opening.entity.eid)
    equal(comp(m, 'doc').title, `Re: ${comp(opening, 'doc').title}`)
  }
})

check('a fixer taking the bug is said once per opening', async (g) => {
  let row = bug()
  await put(g, [row])
  await replay(g, row)
  let take = async (at: string) => {
    await put(g, [{ entity: row.entity, taken: { at, task: 'T-7' } }])
    await follow(g, row)
  }
  let said = async () =>
    (await letters(g)).map((m) => str(comp(m, 'doc').body)).slice(1)
  await take('2026-10-02T00:01:00Z')
  await take('2026-10-02T00:01:30Z')
  let [word, ...more] = await said()
  equal(more.length, 0)
  ok(word.includes('A fixer started on it'), word)
  ok(word.includes('working T-7'), word)
  await put(g, [{
    entity: row.entity,
    regressed: { at: '2026-10-02T00:02:00Z' },
  }])
  await replay(g, row)
  await follow(g, row)
  equal((await said()).filter((b) => b.includes('fixer')).length, 1)
  await take('2026-10-02T00:03:00Z')
  equal((await said()).filter((b) => b.includes('fixer')).length, 2)
})

check(
  'a bug that opened without a letter stays quiet when resolved',
  async (g) => {
    let row = bug()
    row.bug = { ...comp(row, 'bug'), first: '2026-09-20T00:00:00Z' }
    await put(g, [row])
    await replay(g, row)
    await put(g, [{
      entity: row.entity,
      resolved: { at: '2026-10-02T00:01:00Z' },
    }])
    await follow(g, row)
    equal((await letters(g)).length, 0)
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
  await replay(g, row)
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

// A space's openings go to its stream instead of a letter.
let streamed = async (g: Desk, row: Bundle) => {
  let pushed: Bundle[] = []
  await replay(g, row, { notify: (bugs) => void pushed.push(...bugs) })
  return pushed.map((b) => b.entity.eid)
}

check(
  'archived bugs never notify, repeats do not create another letter',
  async (g) => {
    let row = { ...bug(), archived: {} }
    await put(g, [row])
    await replay(g, row)
    equal((await letters(g)).length, 0)
    equal(await streamed(g, row), [])
  },
)

check('space openings still use their notify stream', async (g) => {
  let row = bug()
  await put(g, [row])
  equal(await streamed(g, row), [row.entity.eid])
  equal((await letters(g)).length, 0)
  ok(!(await g.get([row.entity.eid]))[0].notified)
})

check(
  'a bug opening from occurrences a day old is marked seen without a letter',
  async (g) => {
    let row = bug()
    row.bug = { ...comp(row, 'bug'), first: '2026-09-20T00:00:00Z' }
    await put(g, [row])
    await replay(g, row)
    equal((await letters(g)).length, 0)
    let [seen] = await g.get([row.entity.eid])
    ok(seen?.notified)
  },
)

check(
  'a bug opening from a recent occurrence still gets its letter',
  async (g) => {
    let row = bug()
    row.bug = { ...comp(row, 'bug'), first: at }
    await put(g, [row])
    await replay(g, row)
    equal((await letters(g)).length, 1)
  },
)

// The platform tracker holds a copy of each box bug; the box writes its letter.
let source = (row: Bundle, from: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  error: { at, bug: row.entity.eid, tags: { source: from } },
})

check('a bug forwarded by the box gets its letter only there', async (g) => {
  let boxed = bug(), mixed = bug()
  await put(g, [
    boxed,
    mixed,
    source(boxed, 'box'),
    source(mixed, 'box'),
    source(mixed, 'yaks.app'),
  ])
  await replay(g, boxed, { forwarded: ['box'] })
  await replay(g, mixed, { forwarded: ['box'] })
  equal(
    (await letters(g)).map((m) => comp(m, 'mail').target),
    [mixed.entity.eid],
  )
  ok((await g.get([boxed.entity.eid]))[0].notified)
})

check(
  "a platform bug's letter opens it on the side the tracker web reads it from",
  async (g) => {
    let row = bug()
    row.entity = { ...row.entity, num: 7 }
    await put(g, [row])
    await replay(g, row, { side: 'yaks.app' })
    let [letter] = await letters(g)
    let { title, body } = comp(letter, 'doc') as Record<string, string>
    let eid = row.entity.eid
    ok(title.includes(`${eid}: `), title)
    ok(
      body.includes(
        `(https://bugs.example.test/?q=.bug&side=yaks.app&bug=${eid})`,
      ),
      body,
    )
  },
)
