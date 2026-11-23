import { platform } from './directory-rows-probe.ts'
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Directory, Seat } from './directory.ts'
import { answer, at } from './install.ts'
import { sign } from './lib/token.ts'
import { dataset } from './testing.ts'
import { connector, kernel, signIn, unique } from './probe.ts'

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
  headers: Record<string, string> = {},
) =>
  new Request(`https://yaks.app${at(name, back)}`, {
    method,
    headers: {
      'user-agent': BROWSER,
      ...headers,
      cookie: [signed ? cookie : '', headers.cookie ?? ''].filter(Boolean)
        .join('; '),
    },
    ...method == 'POST' ? { body: new URLSearchParams() } : {},
  })
// A stranger's press from a listing of ours, or another site's post, and the
// press cookie its answer sets, if any.
let OURS = { 'sec-fetch-site': 'same-origin' }
let THEIRS = { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }
let press = async (from: Record<string, string>, name = 'trip-plan') =>
  (await answer(request('POST', false, name, false, from), env, dir)).headers
    .getSetCookie().find((c) => c.startsWith('__Host-yak_press='))
    ?.split(';')[0]

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
  // An agent's check that opened the listing by an agent-check link presses
  // under that source, which the funnel counts apart (funnel.ts `WHO`).
  let check = { cookie: 'yak_came=utm_source=agent-check&at=5' }
  await answer(request('POST', false, 'trip-plan', false, check), {
    ...env,
    VIEWS: views,
  }, dir)
  assertEquals(views.points.splice(0).map((p) => p.blobs![6]), [
    'agent-check//',
  ])
})

test('only a press from our own page is kept for the way back, and only for its app', async () => {
  assertEquals(await press(THEIRS), undefined)
  let pressed = await press(OURS)
  let back = (name = 'trip-plan', held = pressed!) =>
    answer(request('GET', true, name, true, { cookie: held }), env, dir)
  // With two spaces to choose from, the press still leaves the choice to the
  // form, and is spent.
  let form = await back()
  assertEquals(form.status, 200)
  assertStringIncludes(await form.text(), 'name="space"')
  assertStringIncludes(
    form.headers.get('set-cookie')!,
    '__Host-yak_press=; Path=/; Max-Age=0',
  )
  // A press of one app opens no other's way back.
  let other = await press(OURS, 'withdrawn')
  assertEquals((await back('trip-plan', other!)).status, 200)
})

// The whole way through the kernel: a stranger presses a listing's "Make your
// own copy", signs up, and lands in their copy with no form between.
test('a stranger who pressed for a copy and signed up lands in it', async () => {
  let k = await kernel()
  try {
    let maker = await signIn(k)
    let space = maker.email.split('@')[0]
    let agent = connector(k, maker.cookie)
    let slug = unique('recipes')
    await agent.tool('app_new', { space, slug, title: 'Recipes' })
    await agent.tool('app_files', {
      space,
      app: slug,
      op: 'write',
      path: 'index.html',
      content: '<h1>Recipes</h1>',
    })
    await agent.tool('app_deploy', { space, app: slug })
    await agent.tool('app_publish', { space, app: slug })
    let go = (path: string, init: RequestInit & { headers?: object }) =>
      k.at(k.host, path, {
        redirect: 'manual',
        ...init,
        headers: { 'user-agent': BROWSER, ...init.headers },
      })
    let pressed = await go(at(slug), { method: 'POST', headers: OURS })
    assertEquals(pressed.status, 303)
    let back = new URL(
      new URL(pressed.headers.get('location')!).searchParams
        .get('return')!,
    )
    let held = pressed.headers.getSetCookie()
      .find((c) => c.startsWith('__Host-yak_press='))!.split(';')[0]
    let ada = await signIn(k)
    k.views.points.splice(0)
    let landed = await go(back.pathname + back.search, {
      headers: { cookie: `${ada.cookie}; ${held}` },
    })
    assertEquals(landed.status, 303)
    let copy = new URL(landed.headers.get('location')!)
    assertEquals(copy.hostname, `${ada.name}.${k.host}`)
    assertEquals(
      k.views.points.map((p) => p.blobs![1])
        .filter((s) => s.startsWith('install')),
      ['install_back', 'install_done'],
    )
    // The same address again, the press spent, shows the form.
    let again = await go(back.pathname + back.search, {
      headers: { cookie: ada.cookie },
    })
    assertEquals(again.status, 200)
    await again.body?.cancel()
  } finally {
    await k.stop()
  }
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
