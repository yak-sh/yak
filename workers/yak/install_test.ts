import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Directory, Seat } from './directory.ts'
import type { Env } from './env.ts'
import { answer, at } from './install.ts'
import { sign } from './lib/token.ts'

let env = { SESSION_SECRET: 'install-test' } as Env
// A session as the sign-in mints it, naming the browser it was signed in
// from (session.ts `minted`).
let cookie = `yak_session=${await sign({
  person: 'person',
  space: null,
  exp: Math.floor(Date.now() / 1000) + 3600,
  via: 'b0000000-0000-4000-8000-000000000001',
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

// The page's one form, read from its markup by where its quotes fall: a DOM
// parser's first parse costs this file several times its budget, and a
// regular expression's first match compiles it.
let quoted = (text: string, from: string) => {
  let at = text.indexOf(from) + from.length
  return at < from.length ? undefined : text.slice(at, text.indexOf('"', at))
}
let formOf = (html: string) => {
  let form = html.slice(html.indexOf('<form'), html.indexOf('</form>'))
  let tag = form.slice(0, form.indexOf('>'))
  return {
    method: quoted(tag, ' method="'),
    action: quoted(tag, ' action="'),
    options: form.split('<option value="').slice(1)
      .map((option) => option.slice(0, option.indexOf('"'))),
  }
}

let signedIn = request('GET')
test('an install page offers only writable spaces without making a copy', async () => {
  let response = await answer(signedIn, env, dir)
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
