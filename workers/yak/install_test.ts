import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Directory, Seat } from './directory.ts'
import type { Env } from './env.ts'
import { answer, at } from './install.ts'
import { sign } from './lib/token.ts'

let env = { SESSION_SECRET: 'install-test' } as Env
let cookie = `yak_session=${await sign({
  person: 'person',
  space: null,
  exp: Math.floor(Date.now() / 1000) + 3600,
}, env.SESSION_SECRET!)}`
let spaces = ['owner', 'editor', 'reader'].map((role) => ({
  role,
  space: { slug: role, title: role, trashed: null },
})) as Seat[]
let dir = {
  offered: (name: string) =>
    Promise.resolve(
      name == 'trip-plan'
        ? {
          space: {},
          app: { title: 'Trip plan', published: { name } },
        }
        : null,
    ),
  seats: () => Promise.resolve(spaces),
} as unknown as Directory
let request = (method: string, signed = true, name = 'trip-plan') =>
  new Request(`https://yaks.app${at(name)}`, {
    method,
    headers: signed ? { cookie } : {},
    ...method == 'POST' ? { body: new URLSearchParams() } : {},
  })

test('install sign-in keeps the chosen app as its return address', async () => {
  let response = await answer(request('POST', false), env, dir)
  assertEquals(response.status, 303)
  let login = new URL(response.headers.get('location')!)
  assertEquals(login.pathname, '/login')
  assertEquals(
    login.searchParams.get('return'),
    'https://yaks.app/install?name=trip-plan',
  )
})

// The page's one form, read from its markup: a DOM parser's first parse
// costs this file several times its budget.
let FORM = /<form([^>]*)>([\s\S]*?)<\/form>/
let formOf = (html: string) => {
  let [, attrs = '', body = ''] = html.match(FORM) ?? []
  let attr = (name: string) =>
    attrs.match(new RegExp(` ${name}="([^"]*)"`))?.[1]
  return {
    method: attr('method'),
    action: attr('action'),
    options: [...body.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]),
  }
}

test('an install page offers only writable spaces without making a copy', async () => {
  let response = await answer(request('GET'), env, dir)
  assertEquals(formOf(await response.text()), {
    method: 'post',
    action: '/install?name=trip-plan',
    options: ['owner', 'editor'],
  })
})

test('a gallery install with several destinations asks where to put the copy', async () => {
  let response = await answer(request('POST'), env, dir)
  assertEquals(response.status, 200)
  assertStringIncludes(await response.text(), 'name="space"')
})

test('an unavailable offer has no install form', async () => {
  let response = await answer(request('POST', true, 'withdrawn'), env, dir)
  assertEquals(response.status, 404)
  assertEquals((await response.text()).includes('<form'), false)
})
