// The admin's door (admin.ts `answer`): who it is drawn for, and what a list's
// search and a row's page find, read from the directory as it keeps them.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { answer, PAGE, staff } from './admin.ts'
import { directoryOf, META } from './directory.ts'
import { COOKIE, sign, verify } from './lib/token.ts'
import { lost } from './pages.ts'
import { platform } from './testing.ts'

let world = platform('admin directory', { SESSION_SECRET: 'secret' })
let env = world.env
let dir = directoryOf(env.STORE)
await dir.stamp({
  entities: [
    { entity: { eid: 'root' }, person: {} },
    { entity: { eid: 'ann' }, person: {}, email: { address: 'ann@x.com' } },
    { entity: { eid: 'home' }, space: { slug: 'ann', store: 'ann' } },
    {
      entity: { eid: 'notes' },
      app: { slug: 'notes', space: 'home', version: 1, access: 'private' },
      doc: { title: 'Field notes' },
    },
    {
      entity: { eid: 'ann-home' },
      member: { space: 'home', person: 'ann', role: 'owner' },
    },
  ],
})
await dir.apply({
  entities: [{
    entity: { eid: 'root-seat' },
    member: {
      person: 'root',
      space: (await dir.space(META.space))!.eid,
      role: 'owner',
    },
  }],
}, { 'x-yak-person': 'root', 'x-yak-role': 'owner', 'x-yak-kernel': '1' })

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
let asking = (path: string, person?: string) =>
  [
    new Request(`https://yaks.app${path}`, {
      headers: person ? { cookie: cookies[person] } : {},
    }),
    env,
    path.split('?')[0],
    dir,
  ] as const
let html = async (path: string) => {
  let out = (await answer(...asking(path, 'root')))!
  return { status: out.status, text: await out.text() }
}
let outsider = asking('/admin/people')
let person = asking('/admin/people', 'ann')
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
  assertEquals(await html('/admin?q=ann'), await html('/admin/people?q=ann'))
})

test("the admin's people list shows who a search finds, and nobody else", async () => {
  let found = await html('/admin/people?q=ann')
  assertEquals(found.status, 200)
  assertStringIncludes(found.text, 'ann@x.com')
  assertEquals(
    (await html('/admin/people?q=nobody')).text.includes('ann@x.com'),
    false,
  )
})

test('a person in the admin directory opens to the spaces they own', async () => {
  let { status, text } = await html('/admin/ann')
  assertEquals(status, 200)
  assertStringIncludes(text, 'Owner of')
  assertStringIncludes(text, 'ann.yaks.app')
})

test('the admin app search finds app names through their space', async () => {
  for (let q of ['ann', 'ann/notes', 'field']) {
    let { status, text } = await html(`/admin/apps?q=${q}`)
    assertEquals(status, 200)
    assertStringIncludes(text, 'Field notes')
    assertStringIncludes(text, 'ann/notes')
  }
})

test('a list draws a page of its rows, most recently active first, and the next page after the last', async () => {
  let at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString()
  let many = Array.from({ length: PAGE + 2 }, (_, i) => ({
    entity: { eid: `paged-${i}` },
    person: {},
    email: { address: `paged-${i}@example.com` },
    used: { at: at(i) },
  }))
  await dir.stamp({ entities: many })
  // Each person the page draws, by number.
  let paged = (text: string) =>
    [...text.matchAll(/paged-(\d+)@example/g)].map((m) => +m[1])
  let first = await html('/admin/people?q=paged-')
  assertEquals(
    paged(first.text),
    Array.from({ length: PAGE }, (_, i) => PAGE + 1 - i),
  )
  let next = /href="([^"]*after=[^"]*)"/.exec(first.text)![1]
    .replaceAll('&amp;', '&')
  let rest = await html(next)
  assertEquals(paged(rest.text), [1, 0])
  assertEquals(rest.text.includes('after='), false)
})
