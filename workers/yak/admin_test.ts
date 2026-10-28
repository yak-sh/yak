// The platform admin's directory (admin.ts): what each row uses, counted over
// the whole directory, and the door that draws it for the admin alone.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { answer, type Census, uses } from './admin.ts'
import { type Directory, META, type Meter, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { COOKIE, sign } from './lib/token.ts'
import { drawn } from './render/mod.ts'

let ROOT = { eid: 'meta', slug: META.space } as Space
let SECRET = 'secret'
let EMPTY: Census = { people: [], spaces: [], apps: [], seats: [] }
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
      meter: meter({ requests: 40, bytes: 100 }),
      used: { at: '2026-10-12T00:00:00Z' },
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
})

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
