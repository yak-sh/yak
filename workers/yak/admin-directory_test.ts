import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  answer,
  type Census,
  list,
  listing,
  page,
  possessions,
  read,
  staff,
} from './admin.ts'
import { type Directory, META, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { COOKIE, sign, verify } from './lib/token.ts'
import { drawn } from './render/mod.ts'
import { lost } from './pages.ts'
import { markup } from './html.ts'

let root = { eid: 'meta', slug: META.space } as Space
let env = { SESSION_SECRET: 'secret' } as Env
let cookies = Object.fromEntries(
  await Promise.all(
    ['ann', 'root'].map(async (person) =>
      [
        person,
        `${COOKIE}=${await sign({ person, space: null, exp: 4e9 }, 'secret')}`,
      ] as const
    ),
  ),
)
let identities = await Promise.all(
  Object.values(cookies).map((cookie) =>
    verify(cookie.slice(cookie.indexOf('=') + 1), 'secret')
  ),
)
assertEquals(identities.map((identity) => identity?.person), ['ann', 'root'])
let records: Census = {
  people: [{
    policy: { revision: 0 },
    entity: { eid: 'ann' },
    person: {},
    email: { address: 'ann@x.com' },
  }],
  spaces: [{
    policy: { revision: 0 },
    entity: { eid: 'home' },
    space: { slug: 'ann', store: 'ann' },
  }],
  apps: [{
    policy: { revision: 0 },
    entity: { eid: 'notes' },
    app: { slug: 'notes', space: 'home', version: 1, access: 'private' },
    doc: { title: 'Field notes' },
  }],
  seats: [{
    policy: { revision: 0 },
    entity: { eid: 'ann-home' },
    member: { space: 'home', person: 'ann', role: 'owner' },
  }],
  deploys: [],
  referrals: [],
}
let dir = {
  space: (slug: string) => Promise.resolve(slug == META.space ? root : null),
  role: (_: Space, person: string) =>
    Promise.resolve(person == 'root' ? 'owner' : null),
  census: () => Promise.resolve(records),
} as unknown as Directory
let asking = (path: string, person?: string) =>
  [
    new Request(`https://yaks.app${path}`, {
      headers: person ? { cookie: cookies[person] } : {},
    }),
    env,
    path.split('?')[0],
    dir,
  ] as const
let outsider = asking('/admin/people')
let person = asking('/admin/people', 'ann')
let entrance = asking('/admin', 'root')
let projected = read(env, records, false)
assertEquals(projected.spaces.get('home')?.slug, 'ann')
for (let row of [...records.people, ...records.spaces, ...records.apps]) {
  drawn(row, 'Directory.List.Tile')
}
drawn(records.people[0], 'Directory.Page')
let login = new Response(null, {
  status: 302,
  headers: { location: '/login?return=%2Fadmin%2Fpeople' },
})

test('the directory is drawn for the platform admin and nobody else', async () => {
  assertEquals(await staff(outsider[0], env, dir), null)
})

test('a signed-out visitor returns to the directory after signing in', async () => {
  let out = (await answer(...outsider))!
  assertEquals(out.status, login.status)
  assertEquals(out.headers.get('location'), login.headers.get('location'))
})

test('a signed-in person who is not the admin sees no directory', async () => {
  assertEquals(await staff(person[0], env, dir), '')
})

test('the directory refusal page answers not found', () => {
  assertEquals(lost(env).status, 404)
})

test('the admin directory entrance opens its people list', async () => {
  let door = (await answer(...entrance))!
  assertEquals(door.headers.get('location'), '/admin/people')
})

test("the admin's people list shows who a search finds", () => {
  assertStringIncludes(markup(listing(projected, 'people', 'ann')), 'ann@x.com')
})

test('a person in the admin directory opens to the spaces they own', () => {
  let html = markup(possessions(projected, records.people[0]))
  assertStringIncludes(html, 'Owner of')
  assertStringIncludes(html, 'ann.yaks.app')
})

test('the admin app search finds app names through their space', () => {
  let html = markup(listing(projected, 'apps', 'ann'))
  assertStringIncludes(html, 'Field notes')
  assertStringIncludes(html, 'ann/notes')
})

test('a matched admin list answers a page', () => {
  assertEquals(list(projected, 'people', 'ann').status, 200)
})

test('a matched admin app list answers a page', () => {
  assertEquals(list(projected, 'apps', 'ann').status, 200)
})

test('a person in the admin directory answers a page', async () => {
  assertEquals((await page(projected, dir, records.people[0], env)).status, 200)
})
