import { platform } from './directory-rows-probe.ts'
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Directory, Seat } from './directory.ts'
import { answer, at } from './install.ts'
import { sign } from './lib/token.ts'
import { dataset } from './testing.ts'

let auth = platform('install-test')
await auth.dir.stamp({ entities: [{ entity: { eid: 'person' }, person: {} }] })
let env = auth.env
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
  emailAt: () => Promise.resolve('ada@example.com'),
} as unknown as Directory
let BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
let request = (
  method: string,
  signed = true,
  name = 'trip-plan',
  back = false,
) =>
  new Request(`https://yaks.app${at(name, back)}`, {
    method,
    headers: { 'user-agent': BROWSER, ...signed ? { cookie } : {} },
    ...method == 'POST' ? { body: new URLSearchParams() } : {},
  })

test('install sign-in keeps the chosen app as its return address', async () => {
  let response = await answer(request('POST', false), env, dir)
  assertEquals(response.status, 303)
  let login = new URL(response.headers.get('location')!)
  assertEquals(login.pathname, '/login')
  assertEquals(
    login.searchParams.get('return'),
    'https://yaks.app/install?name=trip-plan&from=sign-in',
  )
})

test('the funnel counts a stranger sent to sign in, one back from it, and somebody shown the form, each apart', async () => {
  let views = dataset()
  let steps = async (req: Request) => {
    await answer(req, { ...env, VIEWS: views }, dir)
    return views.points.splice(0).map((p) => p.blobs![1])
  }
  // A press of a listing's "Make your own copy" by a stranger.
  assertEquals(await steps(request('POST', false)), ['install_sign_in'])
  // A stranger following a link, or a machine fetching it, presses nothing.
  assertEquals(await steps(request('GET', false)), [])
  assertEquals(await steps(request('GET', true, 'trip-plan', true)), [
    'install_back',
    'install_form',
  ])
  assertEquals(await steps(request('GET')), ['install_form'])
  // Pressed signed in with two spaces to choose from, the form asks which.
  assertEquals(await steps(request('POST')), ['install_form'])
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
