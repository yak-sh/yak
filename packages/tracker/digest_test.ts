// The digest is written when its wake fires, once a day, from the bug rows.
import { equal, ok, test } from '@yaks/testing'
import { fixture } from './fixture_test.ts'
import { digest, series, wake } from './digest.ts'
import { comp, str } from './model.ts'
import { days, query } from './chart.ts'

let now = Date.parse('2026-11-20T12:00:00Z')
let bug = (eid: string, rest: object) => ({
  entity: { eid },
  doc: { title: `Error: ${eid} | broke` },
  bug: { fault: eid, hits: 1 },
  ...rest,
})
let rows = [
  bug('new', {
    bug: {
      first: '2026-11-20T09:00:00Z',
      hits: 4,
      account: 'person',
      people: 2,
    },
  }),
  bug('fixed', {
    bug: { first: '2026-11-19T11:00:00Z' },
    resolved: { at: '2026-11-19T13:00:00Z', cause: 'a leak' },
  }),
  bug('taken', {
    bug: { first: '2026-11-10T12:00:00Z', hits: 9 },
    taken: { task: 'T-12' },
  }),
  bug('old', { bug: { first: '2026-09-01T00:00:00Z' }, archived: {} }),
]
let places = {
  bug: (eid: string) => `https://bugs.example/${eid}`,
  chart: 'https://c.example/chart.png',
}

test('the digest names new, fixed and open bugs, whom they reached and who is on them', () => {
  let { title, body } = digest(rows, now, places)
  equal(title, 'Bugs, Nov 20: 1 new, 1 fixed, 2 open, 1 reached a person')
  ok(
    body.includes(
      '| [Error: new \\| broke](https://bugs.example/new) | 4 | **2 people** |  |',
    ),
  )
  ok(
    body.includes(
      '| [Error: fixed \\| broke](https://bugs.example/fixed) | 2h |  |',
    ),
  )
  ok(
    body.includes(
      '| [Error: taken \\| broke](https://bugs.example/taken) | 10d | 9 |  | T-12 |',
    ),
  )
  ok(body.includes('| nobody |'))
  ok(!body.includes('Error: old'))
  ok(
    body.startsWith(
      '![Bugs opened and fixed each day, and time to fix](https://c.example/chart.png?d=2026-11-07&',
    ),
  )
})

test('the chart counts openings and fixes on their days, and its address carries them', () => {
  let drawn = series(rows, now)
  equal(drawn.length, 14)
  equal(drawn.at(-1), { day: '2026-11-20', opened: 1, fixed: 0 })
  equal(drawn.at(-2), {
    day: '2026-11-19',
    opened: 1,
    fixed: 1,
    fix: 7_200_000,
  })
  equal(drawn[3], { day: '2026-11-10', opened: 1, fixed: 0 })
  equal(days(new URLSearchParams(query(drawn))), drawn)
})

test("a firing writes the day's digest once, and the next day's is another letter", async () => {
  let jeff = crypto.randomUUID()
  let g = fixture({ to: jeff, from: 'task@bot.yak.sh', store: 's' })
  await g.apply([
    { entity: { eid: jeff }, email: { address: 'jeff@example.test' } },
    ...rows,
    wake(now),
  ], { trusted: true })
  let fire = (at: string) =>
    g.apply([{ entity: wake(now).entity, fired: { at } }], { trusted: true })
  await fire('2026-11-20T12:00:00.000Z')
  await fire('2026-11-20T12:05:00.000Z')
  let letters = await g.read('.mail *')
  equal(letters.length, 1)
  equal(str(comp(letters[0], 'deliver').to), jeff)
  equal(str(comp(letters[0], 'mail').from), 'task@bot.yak.sh')
  ok(str(comp(letters[0], 'doc').title).startsWith('Bugs, Nov 20: 1 new'))
  await fire('2026-11-21T12:00:00.000Z')
  equal((await g.read('.mail')).length, 2)
})

test("the host's own sections lead the digest, and one that fails is reported, never the letter", async () => {
  let jeff = crypto.randomUUID()
  let failed: unknown[] = []
  let send = async (more: () => Promise<string[]>) => {
    let g = fixture({
      to: jeff,
      store: 's',
      more,
      report: (e) => void failed.push(e),
    })
    await g.apply([
      { entity: { eid: jeff }, email: { address: 'jeff@example.test' } },
      ...rows,
      wake(now),
    ], { trusted: true })
    await g.apply([{
      entity: wake(now).entity,
      fired: { at: '2026-11-20T12:00:00.000Z' },
    }], { trusted: true })
    return str(comp((await g.read('.mail *'))[0], 'doc').body)
  }
  ok(
    (await send(() => Promise.resolve(['## Trials\n\n3 begun']))).startsWith(
      '## Trials',
    ),
  )
  ok((await send(() => Promise.reject(new Error('no')))).includes('## New'))
  equal(failed.length, 1)
})

test("a section lists fifteen, a person's first, and counts the rest", () => {
  let many = Array.from({ length: 20 }, (_, i) =>
    bug(`b${i}`, {
      bug: {
        first: '2026-11-20T09:00:00Z',
        hits: i,
        ...i == 0 ? { account: 'person', people: 1 } : {},
      },
    }))
  let { body } = digest(many, now, places)
  let open = body.slice(body.indexOf('## Open (20)'))
  equal(open.split('\n').filter((l) => l.startsWith('| [')).length, 15)
  ok(open.indexOf('b0 \\|') < open.indexOf('b19 \\|'))
  ok(open.includes('And 5 more.'))
})
