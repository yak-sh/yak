// The platform admin's directory (admin.ts): what each row uses, counted over
// the whole directory, and the door that draws it for the admin alone.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { answer, type Census, uses } from './admin.ts'
import {
  type Directory,
  directory,
  fetch as directoryFetch,
  META,
  type Meter,
  type Space,
} from './directory.ts'
import { platform } from './testing.ts'
import type { Env } from './env.ts'
import { COOKIE, sign } from './lib/token.ts'
import { drawn } from './render/mod.ts'

let ROOT = { eid: 'meta', slug: META.space } as Space
let SECRET = 'secret'
let EMPTY: Census = {
  people: [],
  spaces: [],
  apps: [],
  seats: [],
  deploys: [],
}
// Sessions as the sign-in mints them, made once.
let SIGNED_IN = Object.fromEntries(
  await Promise.all(['ann', 'root'].map(async (person) => [
    person,
    `${COOKIE}=${await sign({ person, space: null, exp: 4e9 }, SECRET)}`,
  ])),
)
let NOW = new Date('2026-10-14T12:00:00Z')
let meter = (m: Partial<Meter>) => ({ month: '2026-10', ...m })
let census = (): Census => ({
  people: [
    { entity: { eid: 'ann' }, person: {}, email: { address: 'ann@x.com' } },
    {
      entity: { eid: 'bot' },
      person: {},
      email: { address: 'probe@bot.yak.sh' },
      used: { at: '2026-10-13T00:00:00Z' },
      signed_in: { at: '2026-10-14T09:00:00Z' },
    },
  ],
  spaces: [
    {
      entity: { eid: 'home' },
      space: { slug: 'ann', store: 'ann' },
      meter: meter({ models: 0.25, realtime: 0.25, files: 20 }),
    },
    {
      entity: { eid: 'shop' },
      space: { slug: 'shop', store: 'shop' },
      plan: { tier: 'plus' },
      meter: meter({ models: 1, files: 3 }),
    },
    { entity: { eid: 'lab' }, space: { slug: 'lab', store: 'lab' } },
  ],
  // Each wears its access mode, as every stored app does: a row without one
  // is reported as a failure (directory.ts `unsaid`).
  apps: [
    {
      entity: { eid: 'a1' },
      app: { slug: 'notes', space: 'home', version: 2, access: 'private' },
      meter: meter({ requests: 40, bytes: 100, visits: 7 }),
      used: { at: '2026-10-12T00:00:00Z' },
      changed: { at: '2026-10-11T00:00:00Z' },
      errored: { at: '2026-10-10T00:00:00Z' },
    },
    {
      entity: { eid: 'a2' },
      app: { slug: 'cart', space: 'shop', version: 1, access: 'public' },
      meter: { month: '2026-09', requests: 9, bytes: 990 },
      used: { at: '2026-10-14T10:00:00Z' },
    },
    {
      entity: { eid: 'a3' },
      app: { slug: 'old', space: 'shop', version: 1, access: 'private' },
      meter: { bytes: 7, files: 3 },
      trashed: { at: '2026-10-01T00:00:00Z' },
    },
    {
      entity: { eid: 'a4' },
      app: { slug: 'try', space: 'lab', version: 1, access: 'open' },
    },
  ],
  seats: [
    {
      entity: { eid: 's1' },
      member: { space: 'home', person: 'ann', role: 'owner' },
    },
    {
      entity: { eid: 's2' },
      member: { space: 'shop', person: 'ann', role: 'owner' },
    },
    {
      entity: { eid: 's3' },
      member: { space: 'lab', person: 'bot', role: 'owner' },
    },
    {
      entity: { eid: 's4' },
      member: { space: 'shop', person: 'bot', role: 'viewer' },
    },
  ],
  deploys: [
    {
      entity: { eid: 'd1' },
      deploy: { app: 'a1' },
      created: { at: '2026-10-02T00:00:00Z' },
    },
    {
      entity: { eid: 'd2' },
      deploy: { app: 'a1' },
      created: { at: '2026-10-09T00:00:00Z' },
    },
  ],
} as Census)

test('a person uses what the spaces they own use, from one budget', () => {
  let u = uses(census(), NOW)
  assertEquals(u.get('ann'), {
    spend: { spent: 1.5, limit: 3.2 },
    storage: 1120,
    apps: 2,
    active: '2026-10-14T10:00:00Z',
    test: false,
  })
  assertEquals(u.get('bot')?.active, '2026-10-14T09:00:00Z')
  assertEquals(u.get('bot')?.test, true)
})

test('a space counts its live apps and its latest use; an app its month', () => {
  let u = uses(census(), NOW)
  assertEquals(u.get('shop'), {
    spend: { spent: 1 },
    storage: 1000,
    apps: 1,
    active: '2026-10-14T10:00:00Z',
    test: false,
  })
  assertEquals(u.get('a1')?.requests, 40)
  assertEquals(u.get('a2')?.requests, 0, 'last month is not this month')
  // What a space holds is its apps' data and its files, an app in the trash
  // included, and holding is no month's figure.
  assertEquals(
    ['a1', 'a2', 'a3'].map((a) => u.get(a)?.storage),
    [100, 990, 10],
  )
  assertEquals([u.get('lab')?.test, u.get('a4')?.test], [true, true])
})

test('an app says when it was deployed, changed and broke, and who owns it', () => {
  let u = uses(census(), NOW)
  let a1 = u.get('a1')!
  assertEquals(
    [a1.deployed, a1.changed, a1.errored, a1.visits, a1.owners],
    [
      '2026-10-09T00:00:00Z',
      '2026-10-11T00:00:00Z',
      '2026-10-10T00:00:00Z',
      7,
      ['ann'],
    ],
  )
  let a2 = u.get('a2')!
  assertEquals(
    [a2.deployed, a2.changed, a2.errored, a2.visits],
    [null, null, null, null],
  )
  let c = census()
  let row = drawn(c.apps[0], 'Directory.List.Tile', { uses: a1, space: 'ann' })
  for (
    let said of [
      'ann/notes · ann',
      'Deployed',
      '9 Oct',
      'Data changed',
      '11 Oct',
      'Last error',
      '10 Oct',
      'Requests this month',
      'Visits, 30 days',
    ]
  ) assertStringIncludes(row, said)
  assertStringIncludes(
    drawn(c.apps[1], 'Directory.List.Tile', { uses: a2, space: 'shop' }),
    'not counted yet',
  )
})

let env = { SESSION_SECRET: SECRET } as Env
let dir = {
  space: (slug: string) => Promise.resolve(slug == META.space ? ROOT : null),
  role: (_: Space, person: string) =>
    Promise.resolve(person == 'root' ? 'owner' : null),
  census: () =>
    Promise.resolve({ ...EMPTY, people: census().people.slice(0, 1) }),
} as unknown as Directory
// The directory's words, and its renderers' queries compiled against them,
// are made once an isolate, by the first page to draw a row: made here, so
// a case times its own page.
drawn(census().people[0], 'Directory.List.Tile')
// What the router hands the admin's door for `path`, signed in as `person`.
let asking = (path: string, person?: string) =>
  [
    new Request(`https://yaks.app${path}`, {
      headers: person ? { cookie: SIGNED_IN[person] } : {},
    }),
    env,
    path.split('?')[0],
    dir,
  ] as const
let get = (path: string, person?: string) => answer(...asking(path, person))

test('the directory is drawn for the platform admin and nobody else', async () => {
  let out = (await get('/admin/people'))!
  assertEquals(out.status, 302)
  assertEquals(out.headers.get('location'), '/login?return=%2Fadmin%2Fpeople')
  assertEquals((await get('/admin/people', 'ann'))!.status, 404)
  // The admin is let in: the desk's front door sends them to its first list.
  let door = (await get('/admin', 'root'))!
  assertEquals(door.headers.get('location'), '/admin/people')
})

let search = asking('/admin/people?q=ann', 'root')
test("the admin's people list shows who a search finds", async () => {
  let found = (await answer(...search))!
  assertEquals(found.status, 200)
  assertStringIncludes(await found.text(), 'ann@x.com')
})

test('the census reads which app each release is of and when, never its files', async () => {
  await using p = platform('census deploys')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) }, true)
  let space = await dir.own('census-owner', 'census-deploys')
  await dir.apply({
    entities: [
      {
        entity: { eid: 'census-app' },
        app: {
          slug: 'probe',
          space: space.eid,
          store: 'census-deploys/probe',
          access: 'private',
        },
      },
      {
        entity: { eid: 'census-release' },
        deploy: { app: 'census-app', version: 1, files: '{"a.js":"sha"}' },
      },
    ],
  })
  let { deploys } = await dir.census()
  let [row] = deploys
  assertEquals([deploys.length, row.deploy], [1, { app: 'census-app' }])
  assertEquals(typeof row.created?.at, 'string')
})

test("a row's figures carry their days, and a person's are their spaces' added", () => {
  let c: Census = {
    ...EMPTY,
    people: [{
      entity: { eid: 'ann' },
      person: {},
      email: { address: 'ann@x.com' },
    }],
    spaces: [
      {
        entity: { eid: 's' },
        space: { slug: 'ann' },
        trend: { spend: { '2026-10-14': 0.5 }, requests: { '2026-10-13': 7 } },
      },
      {
        entity: { eid: 't' },
        space: { slug: 'two' },
        trend: { spend: { '2026-10-14': 0.25 } },
      },
    ],
    apps: [{
      entity: { eid: 'a' },
      app: { slug: 'one', space: 's' },
      trend: { requests: { '2026-10-14': 3 } },
    }],
    seats: ['s', 't'].map((space) => ({
      entity: { eid: `seat-${space}` },
      member: { person: 'ann', space, role: 'owner' },
    })),
  } as unknown as Census
  let all = uses(c, NOW)
  assertEquals(all.get('ann')?.spending?.values.at(-1), 0.75)
  assertEquals(all.get('s')?.requesting?.values.at(-2), 7)
  let row = drawn(c.apps[0], 'Directory.List.Tile', {
    uses: all.get('a'),
    base: '/admin',
  })
  assertStringIncludes(row, 'data-chart="line"')
  assertStringIncludes(row, 'data-noun="request"')
  // A quiet row draws its number alone.
  let quiet = drawn(c.apps[0], 'Directory.List.Tile', {
    uses: { requests: 0 },
    base: '/admin',
  })
  assertEquals(quiet.includes('data-chart'), false)
})
