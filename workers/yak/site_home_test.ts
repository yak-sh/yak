// yaks.app's own pages as Site keeps them (site.ts `HOME`): the home app in
// the platform's own space answers them, woven and tagged with the app so a
// release of it purges them, and the Worker's own file answers a page the app
// has none of.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Env } from './env.ts'
import { assets } from './binding-probe.ts'
import { declared } from './directory-fixture.ts'
import { directory, fetch as directoryDoor } from './directory.ts'
import { listingAt } from './kept-page.ts'
import { ADA, ADA_OWNS as OWNS, as, platform } from './serving-probe.ts'
import { fetch as siteFetch, forward, HOME } from './site.ts'
import { answer } from './apex.ts'
import { edged, fetch as appsFetch } from './apps.ts'
import { unfound } from './asset_url.ts'
import { aim } from '@yaks/platform/routes'

let html = (body: string) =>
  `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>${body}</body></html>`

// The deploy's own files: a page of the site as the Worker drew it, anything
// else (the woven scripts) from public/.
let disk = assets(new URL('./public/', import.meta.url))
let ASSETS = {
  fetch: (req: Request) => {
    let path = new URL(req.url).pathname
    return ['/', '/pricing', '/help'].includes(path)
      ? Promise.resolve(
        new Response(html(`the Worker's ${path}`), {
          headers: { 'content-type': 'text/html' },
        }),
      )
      : disk.fetch(req)
  },
} as unknown as Env['ASSETS']

// A platform, with the home app holding `files` where `files` is given.
let site = async (files?: Record<string, string>) => {
  let scenario = platform({ ASSETS })
  let { env } = scenario
  let dir = directory({ fetch: (r: Request) => directoryDoor(r, env) })
  if (files) {
    // The directory's first write seeds the platform's own space.
    await dir.apply({ entities: [{ entity: { eid: ADA }, person: {} }] }, OWNS)
    let space = (await dir.space('yak'))!
    // Ada owns the platform's own space, so she may write its home app.
    await dir.apply({
      entities: [{
        entity: { eid: '$seat' },
        member: { space: space.eid, person: ADA, role: 'owner' },
      }, {
        entity: { eid: '$app' },
        doc: { title: 'yaks.app' },
        app: {
          slug: 'home',
          space: space.eid,
          version: 1,
          access: 'public',
          store: 'yak/home.aaa111',
        },
      }],
    }, OWNS)
    let app = (await dir.app(space, 'home'))!
    await dir.stamp({
      entities: [{ entity: { eid: app.eid }, app: { worker: '' } }],
    }, OWNS)
    await declared(env, space, app)
    for (let [path, text] of Object.entries(files)) {
      scenario.files.held.set(
        `yak/home/${path}`,
        new TextEncoder().encode(text),
      )
    }
  }
  return Object.assign(async (path: string) => {
    let got = await siteFetch(new Request(listingAt('yaks.app', path)), env)
    return {
      status: got.status,
      tags: got.headers.get('cache-tag') ?? '',
      kept: got.headers.get('cache-control') ?? '',
      headers: got.headers,
      text: await got.text(),
    }
  }, { env })
}

let home = await site({
  'wrangler.jsonc': await Deno.readTextFile(
    new URL('../../apps/home/wrangler.jsonc', import.meta.url),
  ),
  'manifest.webmanifest': await Deno.readTextFile(
    new URL('../../apps/home/manifest.webmanifest', import.meta.url),
  ),
  'index.html': html('<h1>the app says hello</h1>'),
  'pricing.html': html('<h1>the app prices</h1>'),
})
let [front, pricing, help, manifest] = await Promise.all(
  ['/', '/pricing', '/help', '/manifest.webmanifest'].map(home),
)

test("the apex's pages are the home app's, kept and purged with it", () => {
  assertStringIncludes(front.text, 'the app says hello')
  assertStringIncludes(pricing.text, 'the app prices')
  for (let page of [front, pricing]) {
    assertEquals(page.status, 200)
    let tags = page.tags.split(',')
    assert(tags.includes('site'), page.tags)
    assert(tags.some((t) => t.startsWith('app:')), page.tags)
    assertStringIncludes(page.kept, 'public')
    // What passes between the gateway and Site, and the browser's own
    // reports, which the apex's report door does not take.
    for (
      let name of [
        'x-yak-keep',
        'x-yak-seen',
        'x-yak-directory-copy',
        'nel',
        'reporting-endpoints',
      ]
    ) {
      assertEquals(page.headers.get(name), null, name)
    }
  }
})

test("the manifest its pages link is the home app's, naming the apex's icons", () => {
  assertStringIncludes(
    front.text,
    '<link rel="manifest" href="/manifest.webmanifest"',
  )
  assertEquals(manifest.status, 200)
  let icons = JSON.parse(manifest.text).icons as { src: string }[]
  assertEquals(icons.map((i) => i.src), ['/icon-512.png', '/icon-192.png'])
  assert(manifest.tags.includes('app:'), manifest.tags)
})

test("the home app's page wears the platform's reporter once, posting to the apex", () => {
  let reporters = front.text.match(/data-yak-at="[^"]*"[^>]*>/g) ?? []
  let at = reporters.map((tag) => tag.match(/data-yak-at="([^"]*)"/)![1])
  // The woven reporter, release and address listeners, each at the app's
  // mount, the apex's root; the site's own `<script src=report.js>` is left
  // out (sheets.ts `links`).
  assert(at.length > 0, front.text)
  assert(at.every((a) => a == '/'), at.join(' '))
  assert(!/<script src="[^"]*report\.js"/.test(front.text), front.text)
})

test("a page the home app has none of is the Worker's own", () => {
  assertEquals(help.status, 200)
  assertStringIncludes(help.text, "the Worker's /help")
  assert(!help.tags.includes('app:'), help.tags)
})

// The browser's own reports go to the app's door at the address it asked,
// which for a domain carried to the app is the domain's.
let carried = await edged(
  aim(new Request('https://her.com/'), 'her.com', HOME, home.env),
  home.env,
)
await carried.body?.cancel()

test("an app at a domain's root names its report door at that domain", () => {
  assertEquals(
    carried.headers.get('reporting-endpoints'),
    'yak="https://her.com/api/report"',
  )
})

// A visit to the apex as the gateway forwards it, by whoever `cookie` signs in.
let visit = async (path: string, cookie?: string) => {
  let got = await forward(
    new Request(
      `https://yaks.app${path}`,
      cookie ? { headers: { cookie } } : {},
    ),
    home.env,
    path,
  )
  return {
    kept: got.headers.get('cache-control') ?? '',
    tags: got.headers.get('cache-tag'),
    text: await got.text(),
  }
}
let owner = await as(ADA)
let [mine, myPricing, strangers, outsiders] = await Promise.all([
  visit('/', owner),
  visit('/pricing', owner),
  visit('/'),
  visit('/', await as(crypto.randomUUID())),
])

test('a member who may write the home app is served its pages at the apex wearing the pencil, never kept', () => {
  for (let page of [mine, myPricing]) {
    assertStringIncludes(page.text, 'data-yak-edit=')
    // Its doors are the app's own `api/`, which the apex's `/api/` is not.
    assertStringIncludes(page.text, 'data-yak-api="/home/"')
    assertEquals(page.kept, 'private, no-store')
    assertEquals(page.tags, null)
  }
  assertStringIncludes(mine.text, 'the app says hello')
  assertStringIncludes(myPricing.text, 'the app prices')
})

test('a stranger and a person with no seat are answered the page everyone is', () => {
  for (let page of [strangers, outsiders]) {
    assertStringIncludes(page.text, 'the app says hello')
    assert(!page.text.includes('data-yak-edit='), page.text)
    assertStringIncludes(page.kept, 'public')
  }
})

// A release check from a tab left open on yaks.app, by a browser with no
// cookie yet (public/release.js, at the tag's `data-yak-api`).
let checked = await answer(
  new Request('https://yaks.app/home/api/release?version=1'),
  home.env,
  '/home/api/release',
)

test("an open tab of the apex asks the home app's own api of its releases, which leaves a stranger a stranger", async () => {
  assertStringIncludes(strangers.text, 'data-yak-api="/home/"')
  assertEquals(checked.status, 200)
  assertEquals(await checked.json(), { version: 1 })
  assertEquals(checked.headers.get('set-cookie'), null)
})

// A module of the app's own `api/`, at the apex and at the app's address.
let door = 'api/storage.js'
let [atApex, atApp] = await Promise.all([
  answer(
    new Request(`https://yaks.app/home/${door}`, {
      headers: { cookie: owner },
    }),
    home.env,
    `/home/${door}`,
  ),
  appsFetch(new Request(`https://yak.yaks.app/home/${door}`), home.env),
].map(async (got) => {
  let res = await got
  return { status: res.status, text: await res.text() }
}))

test("the pencil's doors at the apex are the home app's own", () => {
  assertEquals(atApex.status, 200)
  assertEquals(atApex, atApp)
})

let none = await site()
let before = await Promise.all(['/', '/pricing'].map(none))

test("before the home app is there, every page is the Worker's own, kept", () => {
  for (let [i, path] of ['/', '/pricing'].entries()) {
    assertEquals(before[i].status, 200)
    assertStringIncludes(before[i].text, `the Worker's ${path}`)
    assertEquals(before[i].tags, 'site')
  }
})

// The app's own files, as `yak admin push apps/home` sends them.
let dir = new URL('../../apps/home/', import.meta.url)
let held = [...Deno.readDirSync(dir)].map((e) => e.name)
let missing = await unfound(
  held,
  (path) => Deno.readTextFile(new URL(path, dir)).catch(() => null),
)

test("the home app's pages load nothing its release lacks: the site's files are yaks.app's", () => {
  assertEquals(missing, [])
})
