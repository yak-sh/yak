// Where an address stops, by what the directory says of it, and which of an
// app's doors a request inside it goes to, for whom.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { chatPath } from './routes.ts'
import {
  type Asked,
  type Asking,
  behind,
  type Door,
  door,
  type Reading,
  rung,
  seen,
} from './ladder.ts'
import { MEMBER } from './refused.ts'

let ada = { slug: 'ada', trashed: null }
let menu = { slug: 'menu', home: false, trashed: null }
let site = { slug: 'site', home: true, trashed: null }
let gone = { trashed: { at: '2026-11-01' } }

type Said = Partial<Reading> & {
  kept?: Response
  formerly?: string
  former?: string
}

// The rung `pathname` stops at, as `[to, what it says]`. A look the ladder
// was not told the answer to throws, so a rung that asks more than it needs
// fails.
let stop = async (
  pathname: string,
  said: Said = {},
  asked: Partial<Asked> = {},
) => {
  let unasked = (what: string) => () => {
    throw new Error(`asked ${what}`)
  }
  let step = await rung({
    host: 'ada.yaks.app',
    method: 'GET',
    pathname,
    search: '',
    ...asked,
  }, {
    kept: () => Promise.resolve(said.kept ?? null),
    page: () =>
      Promise.resolve({
        space: said.space === undefined ? ada : said.space,
        app: said.app ?? null,
        home: said.home ?? null,
      }),
    formerly: said.formerly === undefined
      ? unasked('formerly')
      : () => Promise.resolve(said.formerly ? { slug: said.formerly } : null),
    former: said.former === undefined
      ? unasked('former')
      : () => Promise.resolve(said.former ? { slug: said.former } : null),
  })
  let { to, space: _, read: __, ...rest } = step as Record<string, unknown>
  if ('app' in rest) rest.app = (rest.app as { slug: string }).slug
  return [to, rest]
}

test('rung: the apex has a person’s spaces and nothing else', async () => {
  for (let path of ['/manage/ada', '/ada', '/ada/updates', '/updates']) {
    assertEquals(await stop(path, {}, { host: 'yaks.app' }), ['manage', {}])
  }
  for (let path of ['/x/y', '/pricing']) {
    assertEquals(await stop(path, {}, { host: 'yaks.app' }), ['nothing', {}])
  }
})

test('rung: a page the cache keeps is answered before any read', async () => {
  let kept = new Response('kept')
  assertEquals(await stop('/menu/', { kept }), ['kept', { page: kept }])
})

test('rung: a space that is not here is sent where it went', async () => {
  let none = { space: null }
  assertEquals(
    await stop('/menu/soup', { ...none, formerly: 'bea' }, { search: '?q' }),
    ['sent', { href: 'https://bea.yaks.app/menu/soup?q', status: 301 }],
  )
  assertEquals(
    await stop('/menu/api/apply', { ...none, formerly: 'bea' }, {
      method: 'POST',
    }),
    ['sent', { href: 'https://bea.yaks.app/menu/api/apply', status: 308 }],
  )
  assertEquals(await stop('/x', { ...none, formerly: '' }), [
    'nothing',
    { kept: true },
  ])
})

test('rung: the directory and a trashed space answer nothing', async () => {
  let yak = { space: { slug: 'yak', trashed: null } }
  assertEquals(await stop('/platform/', yak, { host: 'yak.yaks.app' }), [
    'nothing',
    {},
  ])
  let binned = { space: { ...ada, ...gone }, app: menu }
  assertEquals(await stop('/menu/', binned), ['closed', {}])
  assertEquals(await stop('/menu/api/query', binned), ['nothing', {}])
})

test('rung: the old dashboard is sent to its new address', async () => {
  assertEquals(await stop('/_yaks', {}, { search: '?a=1' }), [
    'sent',
    { href: `https://yaks.app${chatPath('ada')}?a=1`, status: 301 },
  ])
  assertEquals(await stop('/_yaks', {}, { method: 'POST' }), [
    'sent',
    { href: `https://yaks.app${chatPath('ada')}`, status: 303 },
  ])
  assertEquals(await stop('/_yaks/nowhere'), ['nothing', {}])
})

test('rung: the old builder door is the space’s, whatever app is home', async () => {
  assertEquals(await stop('/api/build', { home: site }), ['build', {}])
})

test('rung: a trashed app is binned, and its doors are nothing', async () => {
  let app = { ...menu, ...gone }
  assertEquals(await stop('/menu/', { app }), ['binned', { app: 'menu' }])
  assertEquals(await stop('/menu/api/query', { app }), ['nothing', {}])
})

test('rung: a renamed app is sent to its slug, path and query', async () => {
  assertEquals(await stop('/old/soup', { former: 'menu' }, { search: '?x' }), [
    'sent',
    { href: '/menu/soup?x', status: 301 },
  ])
  assertEquals(await stop('/old', { former: 'menu' }), [
    'sent',
    { href: '/menu/', status: 301 },
  ])
})

test('rung: a space with no front page is its index at `/`', async () => {
  assertEquals(await stop('/'), ['index', {}])
  assertEquals(await stop('/robots.txt'), ['robots', {}])
  assertEquals(await stop('/about.html'), ['nothing', { kept: true }])
  assertEquals(await stop('/nope/', { former: '' }), [
    'nothing',
    { kept: true },
  ])
})

test('rung: the home app answers every path no app claims', async () => {
  let home = { home: site }
  assertEquals(await stop('/'), ['index', {}])
  assertEquals(await stop('/', home), [
    'app',
    { app: 'site', path: '/', front: true, bare: '/' },
  ])
  assertEquals(await stop('/about', { ...home, former: '' }), [
    'app',
    { app: 'site', path: '/about', front: true, bare: '/' },
  ])
  // A store door of an app that is not here is no page of the home app's.
  assertEquals(await stop('/nope/api/query', { ...home, former: '' }), [
    'nothing',
    {},
  ])
  assertEquals(await stop('/nope/_web', { ...home, former: '' }), [
    'nothing',
    {},
  ])
})

test('rung: the home app’s own address is the bare hostname', async () => {
  let at = { app: site, home: site }
  assertEquals(await stop('/site/', at, { search: '?q' }), [
    'sent',
    { href: '/?q', status: 302 },
  ])
  // Mounted at a domain's root, it is already there.
  assertEquals(await stop('/site/', at, { mount: '/' }), [
    'app',
    { app: 'site', path: '/', front: true, bare: '/' },
  ])
  assertEquals(await stop('/site/a', at), [
    'app',
    { app: 'site', path: '/a', front: true, bare: '/' },
  ])
})

test('rung: an app is its first segment, from its slash', async () => {
  let at = { app: menu, home: site }
  assertEquals(await stop('/menu', at, { search: '?q' }), [
    'slash',
    { href: '/menu/?q', app: 'menu' },
  ])
  assertEquals(await stop('/menu/soup', at), [
    'app',
    { app: 'menu', path: '/soup', front: false, bare: '/menu/' },
  ])
  assertEquals(await stop('/menu/soup', at, { mount: '/' }), [
    'app',
    { app: 'menu', path: '/soup', front: false, bare: '/' },
  ])
})

let nobody: Asking = { person: null, role: null }
let viewer: Asking = { person: 'p', role: 'viewer' }
let outsider: Asking = { person: 'p', role: null }
let guest: Asking = { person: 'p', role: 'editor', guest: true }

test('seen: a private app opens its page to its members alone', () => {
  assertEquals(seen('private', viewer), 'page')
  assertEquals(seen('private', nobody), 'sign-in')
  assertEquals(seen('private', outsider), 'nothing')
  assertEquals(seen('public', nobody), 'page')
  // The app's own worker, coming back through its grant, is let in.
  assertEquals(seen('private', nobody, true), 'page')
})

// The door `path` goes to for `who` on a private app.
let at = (path: string, who: Asking, method = 'GET') =>
  door({ path, method, who, access: 'private' })

test('door: the data editor is a page for whoever holds a level', () => {
  assertEquals(at('/_web/data', nobody), { to: 'data', part: 'sign-in' })
  assertEquals(at('/_web/data', outsider), { to: 'data', part: 'nothing' })
  assertEquals(at('/_web/data', guest), { to: 'data', part: 'editor' })
  assertEquals(at('/_web/data.js', viewer), { to: 'data', part: 'script' })
  assertEquals(at('/_web/assets/skin.css', viewer), {
    to: 'data',
    part: 'asset',
    name: 'skin.css',
  })
  assertEquals(at('/_web/data', viewer, 'POST'), {
    to: 'refused',
    status: 405,
    code: 'method_not_allowed',
  })
})

test('door: a page says it ran to whoever may see it', () => {
  assertEquals(at('/_web/seen', viewer, 'POST'), { to: 'seen' })
  assertEquals(
    door({ path: '/_web/seen', method: 'POST', who: nobody, access: 'public' }),
    { to: 'seen' },
  )
  // A stranger to a private app has no page to have run.
  assertEquals(at('/_web/seen', nobody, 'POST').to, 'refused')
})

test('door: the web page is a member’s, refused in JSON', () => {
  assertEquals(at('/_web', nobody), {
    to: 'refused',
    status: 401,
    code: 'not_a_reader',
    signIn: true,
  })
  let member: Door = {
    to: 'refused',
    status: 403,
    code: 'not_a_reader',
    says: MEMBER.not_a_reader,
  }
  assertEquals(at('/_web', outsider), member)
  assertEquals(at('/_web', guest), member)
  assertEquals(at('/_web', viewer), { to: 'web' })
  assertEquals(at('/_web/web/page.js', viewer), {
    to: 'web',
    asset: 'page.js',
  })
  assertEquals(at('/_web/inspect/app.js', viewer), {
    to: 'web',
    asset: 'inspect/app.js',
  })
})

test('door: the store doors are the kernel’s, whoever asks', () => {
  assertEquals(at('/api/query', nobody), { to: 'api', door: '/query' })
  assertEquals(at('/api/apply', viewer, 'POST'), { to: 'api', door: '/apply' })
})

test('door: a page, and a form the store must hold', () => {
  assertEquals(at('/soup', nobody), { to: 'page', seen: 'sign-in' })
  assertEquals(at('/form/rsvp%20card', viewer), {
    to: 'page',
    seen: 'page',
    form: 'rsvp card',
  })
  assertEquals(at('/form/%E0', viewer), {
    to: 'refused',
    status: 404,
    code: 'not_found',
  })
  assertEquals(at('/form/a/b', viewer), { to: 'page', seen: 'page' })
})

test('behind: the worker first, its files behind it, then the gate', async () => {
  let held = (files: boolean) => () => Promise.resolve(files)
  let unasked = () => Promise.reject(new Error('asked held'))
  let cases = [
    ['answer', 'nothing', unasked, 'worker'],
    ['none', 'page', unasked, 'files'],
    ['pass', 'page', unasked, 'files'],
    // A stranger is sent to sign in for a page the app has, never for one
    // it does not.
    ['pass', 'sign-in', held(false), 'pass'],
    ['pass', 'sign-in', held(true), 'sign-in'],
    ['pass', 'nothing', held(true), 'shut'],
    ['none', 'sign-in', unasked, 'sign-in'],
    ['none', 'nothing', unasked, 'shut'],
  ] as const
  for (let [worker, page, files, want] of cases) {
    assertEquals(
      await behind({ worker, seen: page, held: files }),
      want,
      `${worker} ${page}`,
    )
  }
})
