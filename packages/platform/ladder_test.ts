// Where an address stops, by what the directory says of it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Asked, type Reading, rung } from './ladder.ts'

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

test('rung: the apex has the dashboard and nothing else', async () => {
  assertEquals(await stop('/manage/ada', {}, { host: 'yaks.app' }), [
    'manage',
    {},
  ])
  assertEquals(await stop('/x', {}, { host: 'yaks.app' }), ['nothing', {}])
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
    { href: 'https://yaks.app/manage/ada?a=1', status: 301 },
  ])
  assertEquals(await stop('/_yaks', {}, { method: 'POST' }), [
    'sent',
    { href: 'https://yaks.app/manage/ada', status: 303 },
  ])
  assertEquals(await stop('/_yaks/nowhere'), ['nothing', {}])
})

test('rung: the builder is the space’s, whatever app is home', async () => {
  assertEquals(await stop('/api/build.js', { home: site }), [
    'build',
    { script: true },
  ])
  assertEquals(await stop('/api/build', { home: site }), [
    'build',
    { script: false },
  ])
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
