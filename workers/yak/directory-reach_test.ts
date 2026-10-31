import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { platformVocab } from './vocab.ts'
import { directory, part, type Row } from './directory.ts'
import { narrowed } from './grants.ts'
import { and, eq, ge } from '@yaks/query'
import { preparedStore } from '../../packages/sqlite/testing.ts'

let vocab = platformVocab()
let g = graph({ storage: ram(vocab), vocab })
let sql = preparedStore(vocab)
let database = graph({ storage: sql, vocab })
let person = crypto.randomUUID()
let rows = [
  { entity: { eid: person }, person: {} },
  ...['one', 'two', 'other', 'yak', 'trash'].map((eid) => ({
    entity: { eid },
    space: { slug: eid, store: eid },
    ...(eid == 'trash' ? { trashed: { at: '2026-10-31T00:00:00Z' } } : {}),
  })),
  ...['one', 'two', 'yak', 'trash'].map((space) => ({
    entity: { eid: `seat-${space}` },
    member: { space, person, role: space == 'two' ? 'editor' : 'owner' },
  })),
  ...['one', 'two', 'other', 'yak', 'trash'].map((space) => ({
    entity: { eid: `app-${space}` },
    app: { space, slug: 'recipes', access: 'public', version: 1 },
  })),
  {
    entity: { eid: 'deleted' },
    app: { space: 'one', slug: 'deleted', access: 'public', version: 1 },
    trashed: { at: '2026-10-31T00:00:00Z' },
  },
  { entity: { eid: 'guest' }, person: {} },
  {
    entity: { eid: 'unplaced' },
    app: { slug: 'unplaced', access: 'public', version: 1 },
  },
  {
    entity: { eid: 'grant' },
    grant: { app: 'app-one', person: 'guest', access: 'viewer' },
  },
]
await g.apply(rows, { trusted: true })
await database.apply(rows, { trusted: true })
let asked: string[] = []
let dir = directory(part({
  query: async (q) => {
    asked.push(q)
    return await g.read(q) as Row[]
  },
  apply: () => Promise.resolve([]),
}))
let reach = await dir.reachable(person)
let trips = asked.length
let confined = await narrowed(dir, 'one').reachable(person)
let page = await dir.page('one', 'recipes', 'guest')
let unknown = await dir.reachable(crypto.randomUUID())

test('the directory returns every live member app and its role in one read', () => {
  equal(
    reach.map(({ space, app, role }) => [space.slug, app.slug, role]).sort(),
    [
      ['one', 'recipes', 'owner'],
      ['two', 'recipes', 'editor'],
    ],
  )
  equal(trips, 1)
  equal(unknown, [])
})
test('a narrowed grant confines the directory reach', () => {
  equal(confined.map(({ space }) => space.slug), ['one'])
})
test('app routing returns a visitor’s app grant alongside their seat', () => {
  equal(page.role, null)
  equal([...page.grants!], [['app-one', 'viewer']])
})

let backed = directory(part({
  query: async (q) => await database.read(q) as Row[],
  apply: () => Promise.resolve([]),
}))
let stored = await backed.reachable(person)
let cases = [
  [and(eq('member.space.members_space.member.person', person)), [
    'seat-one',
    'seat-trash',
    'seat-two',
    'seat-yak',
  ]],
  [
    and({
      ...eq('app.space.members_space.member.person', person),
      not: true,
    }),
    ['app-other'],
  ],
  [and(ge('app.space.members_space', 1)), [
    'app-one',
    'app-trash',
    'app-two',
    'app-yak',
    'deleted',
  ]],
] as const
let answers = await Promise.all(cases.map(async ([q]) => {
  let ids = async (graph: typeof g) =>
    (await graph.read(q) as Row[]).map((r) => r.entity.eid).sort()
  return [await ids(g), await ids(database)]
}))
sql[Symbol.dispose]()
for (let [i, [, expected]] of cases.entries()) {
  test(`forward and reverse references agree in memory and storage: ${i}`, () => {
    equal(answers[i], [[...expected], [...expected]])
  })
}
test('the stored directory and memory agree on the caller’s reach', () => {
  equal(
    stored.map(({ space, app, role }) => [space.eid, app.eid, role]).sort(),
    reach.map(({ space, app, role }) => [space.eid, app.eid, role]).sort(),
  )
})

let elevated = await dir.page('other', 'recipes', person, true)
let ordinary = await dir.page('one', 'recipes', 'guest', true)
let confinedPage = await narrowed(dir, 'one').page(
  'other',
  'recipes',
  person,
  true,
)
test('a named snapshot distinguishes a platform admin from an app guest', () => {
  equal(elevated.role, null)
  equal(elevated.administrative, true)
  equal(ordinary.administrative, false)
  equal(confinedPage.role, null)
  equal(confinedPage.administrative, false)
})
