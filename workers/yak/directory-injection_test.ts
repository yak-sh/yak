import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { CallError } from '@yaks/tools/errors'
import { directoryRows, type Row, walkTo } from './directory.ts'
import { platformVocab } from './vocab.ts'

let ids = Array.from({ length: 12 }, () => crypto.randomUUID())
let [victim, own, meta, person, stranger, app, draft, source] = ids
let held: Row[] = [
  ...[[meta, 'yak'], [own, 'own'], [victim, 'victim']].map(([eid, slug]) => ({
    entity: { eid },
    space: { slug, store: slug },
  })),
  { entity: { eid: person }, person: {} },
  { entity: { eid: stranger }, person: {} },
  {
    entity: { eid: app },
    app: { space: victim, slug: 'recipes', access: 'private', version: 1 },
    published: { name: 'recipes', at: '2026-11-15T00:00:00Z' },
  },
  {
    entity: { eid: ids[8] },
    member: { space: victim, person, role: 'editor' },
  },
  {
    entity: { eid: ids[9] },
    member: { space: own, person, role: 'owner' },
  },
]
let revised = (rows: Row[]) =>
  rows.map((row) => ({
    ...row,
    policy: { revision: 0 },
  }))
let supplied = (rows: Row[]) =>
  directoryRows({
    query: () => Promise.resolve(revised(rows)),
    apply: () => Promise.resolve([]),
  })

for (
  let [name, seat, administrative] of [
    ['owner of another space', null, false],
    ['editor of yak', { person, role: 'editor' }, false],
    ['another person owns yak', { person: stranger, role: 'owner' }, false],
    ['owner of yak', { person, role: 'owner' }, true],
  ] as const
) {
  let rows = [
    ...held,
    ...seat
      ? [{
        entity: { eid: ids[10] },
        member: { space: meta, ...seat },
      }]
      : [],
  ]
  let dir = supplied(rows)
  for (
    let [door, read] of [
      ['page', () => dir.page('victim', 'recipes', person, true)],
      ['seat', () => dir.seat(victim, person, true)],
      [
        'holding',
        async () => (await dir.holding('recipes', person, true))!.page!,
      ],
    ] as const
  ) {
    test(`directory ${door}: ${name} has administrative ${administrative}`, async () => {
      let page = await read()
      equal(page.space?.eid, victim)
      equal(page.role, 'editor')
      equal(page.administrative, administrative)
    })
  }
}

let vocab = platformVocab()
let g = graph({ storage: ram(vocab), vocab })
await g.apply([
  ...held,
  {
    entity: { eid: ids[11] },
    hostname: { name: 'victim.example', serves: victim },
    verified: { at: '2026-11-15T00:00:00Z' },
  },
  { entity: { eid: victim }, plan: { customer: 'customer' } },
  { entity: { eid: victim }, seller: { via: 'stripe', account: 'account' } },
  {
    entity: { eid: draft },
    app_draft: { app },
  },
  {
    entity: { eid: crypto.randomUUID() },
    written: { app, draft, path: 'index.html', at: '2026-11-15T00:00:00Z' },
  },
  {
    entity: { eid: crypto.randomUUID() },
    deploy: { app, source, version: 1 },
  },
], { trusted: true })
let dir = directoryRows({
  query: async (q) => revised(await g.read(q) as Row[]),
  apply: () => Promise.resolve([]),
})
let space = (await dir.space('victim'))!
let recipe = (await dir.app(space, 'recipes'))!
let refused = async (
  read: () => unknown | Promise<unknown>,
  expected: unknown,
) => {
  try {
    equal(await read(), expected)
  } catch (error) {
    if (!(error instanceof CallError)) throw error
  }
}

for (
  let [name, read, expected] of [
    ['space', () => dir.space('missing,victim'), null],
    ['page space', async () => (await dir.page('missing,victim')).space, null],
    ['app', () => dir.app(space, 'missing,recipes'), null],
    [
      'page app',
      async () => (await dir.page('victim', 'missing,recipes')).app,
      null,
    ],
    [
      'routing app',
      async () => (await dir.routing(space, 'missing,recipes')).app,
      null,
    ],
    [
      'holding app',
      async () => (await dir.holding('missing,recipes', person))?.holding,
      [],
    ],
    ['customer', () => dir.payer('missing,customer'), null],
    ['seller provider', () => dir.seller('missing,stripe', 'account'), null],
    ['seller account', () => dir.seller('stripe', 'missing,account'), null],
    ['hostname', () => dir.serves('missing,victim.example'), null],
    ['offer', () => dir.offered('missing,recipes'), null],
    ['release source', () => dir.released(recipe, `missing,${source}`), false],
    ['draft', () => dir.written(recipe, `${source},${draft}`), []],
    ['space eid', () => dir.at(`${own},${victim}`), null],
    ['app eid', () => dir.appAt(`${draft},${app}`), null],
    ['space eid list', () => dir.apps([{ eid: `${own},${victim}` }]), []],
    ['walk slug', () => dir.apps(walkTo('missing,victim', victim)), []],
    [
      'injected owner seat',
      async () =>
        (await dir.page(
          `victim)|(.member.person=${person}`,
          'recipes',
          person,
          true,
        )).space,
      null,
    ],
  ] as const
) {
  test(`directory treats ${name} as one operand`, () => refused(read, expected))
}

test('directory eid lists still select each separately supplied space', async () => {
  equal(
    (await dir.apps([{ eid: own }, { eid: victim }])).map((app) => app.eid),
    [app],
  )
})
