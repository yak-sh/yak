// The serving seam, not a second renderer: Apps and Site read the real typed
// directory client through a bound door. Only the directory transport and file
// storage are fixtures. The copy and its deadline are the production ones.
import { clock, equal, ok, test } from '@yaks/testing'
import { edged, fetch as appFetch } from './apps.ts'
import { directory, type Row } from './directory.ts'
import * as dirPart from './directory.ts'
import { EPOCH, type ServingCopyDoor, STALL } from './directory-copy.ts'
import type { Env } from './env.ts'
import { pageAt } from './page-cache.ts'
import { SEEN } from './kept-page.ts'
import { sign } from './lib/token.ts'
import { fetch as siteFetch } from './site.ts'
import { ServingCopy, type ServingCopyState } from './serving-copy.ts'
import { ADA_OWNS, platform, seeded, visit } from './serving-probe.ts'

let copyFixture = () => {
  let saved: ServingCopyState | undefined
  let copy = new ServingCopy({
    persistence: { read: () => saved, write: (state) => saved = state },
  })
  let puts: [number, string, string, boolean][] = []
  let door: ServingCopyDoor = {
    begin: () => Promise.resolve(copy.begin()),
    finish: (revision) => Promise.resolve(copy.finish(revision)),
    read: (key) => Promise.resolve().then(() => copy.read(key)),
    valid: (revision) => Promise.resolve(copy.valid(revision)),
    get: (key) => {
      try {
        return Promise.resolve(copy.get(key))
      } catch (error) {
        return Promise.reject(error)
      }
    },
    put: (revision, key, body) => {
      let accepted = copy.put(revision, key, body)
      puts.push([revision, key, body, accepted])
      return Promise.resolve(accepted)
    },
  }
  return { copy, door, puts }
}

// Exhaust only promise continuations, never a wall-clock sleep. A failed
// fallback is observed as a pending answer rather than hanging the test.
let continuations = async () => {
  // A turn apart: gathered reads leave on the next one (directory-copy.ts).
  for (let turns = 0; turns < 3; turns++) {
    await new Promise((turned) => setTimeout(turned, 0))
    for (let n = 0; n < 64; n++) await Promise.resolve()
  }
}
let watching = (work: Promise<Response>) => {
  let answer: Response | undefined
  let failure: unknown
  void work.then((r) => answer = r, (e) => failure = e)
  return {
    pending: () => answer === undefined && failure === undefined,
    answer: () => {
      if (failure) throw failure
      ok(answer, 'serving did not answer after the directory deadlines')
      return answer!
    },
  }
}

let fixture = (
  access: 'public' | 'open' | 'private' = 'public',
  more: Pick<Row, 'published'> & { source?: string } = {},
) => {
  let time = clock()
  let f = copyFixture()
  let rows: Row[] = [
    { entity: { eid: 's' }, space: { slug: 'ada', store: 'ada' } },
    {
      entity: { eid: 'a' },
      app: {
        slug: 'cookbook',
        space: 's',
        access,
        version: 1,
        source: more.source ?? 'one',
        worker: '',
      },
      ...more.published ? { published: more.published } : {},
    },
  ]
  let stalled = false
  let reads = 0
  let fileReads = 0
  let via = {
    fetch: (req: Request): Promise<Response> => {
      reads++
      // The real door only publishes a revision when the caller requests it.
      let q = new URL(req.url).searchParams.get('q')!
      let answer = Response.json(
        q.startsWith('(.space.slug=')
          ? rows
          : q.startsWith('.space.slug=')
          ? [rows[0]]
          : [rows[1]],
        {
          headers: req.headers.has(EPOCH)
            ? { [EPOCH]: String(f.copy.revision) }
            : {},
        },
      )
      if (!stalled) return Promise.resolve(answer)
      return new Promise(() => {})
    },
  }
  let env = {
    DIRECTORY: via,
    CLOCK: time,
    SERVING_COPY: { idFromName: (name: string) => name, get: () => f.door },
    FILES: {
      fetch: (req: Request) => {
        fileReads++
        return Promise.resolve(
          new Response(`page bytes from ${req.url}`, {
            headers: { 'content-type': 'text/plain', etag: '"page"' },
          }),
        )
      },
    },
    ASSETS: { fetch: () => Promise.resolve(new Response('platform module')) },
  } as unknown as Env
  return {
    ...f,
    env,
    rows,
    reads: () => reads,
    fileReads: () => fileReads,
    stall: () => {
      stalled = true
    },
    // Both sequential reads share one request deadline. Once space resumes,
    // run the routing timer at the same instant, without another wait.
    deadlines: async () => {
      await continuations()
      await time.advance(STALL)
      await continuations()
      await time.advance(0)
      await continuations()
    },
    page: () => edged(visit('/cookbook/'), env),
    site: (path = '/cookbook/') =>
      siteFetch(new Request(pageAt('ada.yaks.app', path, null)), env),
  }
}

// These are serving integration scenarios: execute the real rendering and
// SQLite writes once while loading this module, and register only their
// observations below. They deliberately do not boot a kernel per timed case.
let publicPage = await (async () => {
  let f = fixture()
  let first = await f.page()
  let body = await first.text()
  await continuations()
  let fills = f.puts.length
  f.stall()
  let read = watching(f.page())
  await continuations()
  let waited = read.pending()
  await f.deadlines()
  let answer = read.answer()
  return {
    body,
    got: await answer.text(),
    status: answer.status,
    fills,
    waited,
    reads: f.reads(),
    files: f.fileReads(),
  }
})()
test('directory serving: a known public page answers within the stall deadline when DIRECTORY never does', () => {
  equal(publicPage.fills, 1)
  ok(publicPage.waited)
  equal([publicPage.status, publicPage.got], [200, publicPage.body])
  equal(publicPage.reads, 2)
  equal(publicPage.files, 4) // Rendered anew (page and its redirects), not an old page response.
})

let sitePage = await (async () => {
  let f = fixture()
  let first = await f.site()
  await first.body?.cancel()
  await continuations()
  f.stall()
  let read = watching(f.site())
  await f.deadlines()
  let answer = read.answer()
  await answer.body?.cancel()
  return {
    first: first.status,
    status: answer.status,
    cache: answer.headers.get('cache-control'),
  }
})()
test('directory serving: Site does not cache a page rendered from the copy', () => {
  equal([sitePage.first, sitePage.status], [200, 200])
  ok(sitePage.cache?.includes('no-store'))
})

let cachedPage = await (async () => {
  let f = fixture()
  let page = await f.site()
  let before = f.reads()
  f.env.SITE = { fetch: () => Promise.resolve(page.clone()) }
  let answer = await appFetch(visit('/cookbook/'), f.env)
  await answer.body?.cancel()
  await continuations()
  return { status: answer.status, reads: f.reads() - before }
})()
test('directory serving: a Site answer starts no redundant directory read', () => {
  equal(cachedPage, { status: 200, reads: 0 })
})

let absentPage = await (async () => {
  let f = fixture()
  f.env.DIRECTORY = {
    fetch: () =>
      Promise.resolve(Response.json([], { headers: { [EPOCH]: '0' } })),
  }
  let page = await f.site()
  if (page.status != 404) {
    return { status: page.status, reads: 0, tag: page.headers.get('cache-tag') }
  }
  f.env.SITE = { fetch: () => Promise.resolve(page.clone()) }
  let reads = 0
  f.env.DIRECTORY = {
    fetch: () => {
      reads++
      return Promise.resolve(Response.json([]))
    },
  }
  let answer = await appFetch(visit('/cookbook/'), f.env)
  await answer.body?.cancel()
  return { status: answer.status, reads, tag: page.headers.get('cache-tag') }
})()
test('directory serving: Site answers a missing space without repeating the lookup', () => {
  equal(absentPage, { status: 404, reads: 0, tag: 'site' })
})

let unavailable = []
for (let known of [false, true]) {
  let f = fixture()
  if (known) {
    await (await f.page()).body?.cancel()
    await continuations()
    await f.door.begin()
  }
  f.stall()
  let read = watching(f.page())
  await f.deadlines()
  unavailable.push({ pending: read.pending(), files: f.fileReads() })
}
test('directory serving: cold and fenced copies wait, never returning old pages', () => {
  equal(unavailable, [{ pending: true, files: 0 }, { pending: true, files: 2 }])
})

let privatePage = await (async () => {
  let f = fixture('private')
  let first = await f.page()
  await continuations()
  f.stall()
  let edge = watching(f.page())
  await f.deadlines()
  let pass = edge.answer()
  // The pass is not a page. With the copy fenced, Apps.fetch must wait for
  // the directory before deciding the caller's private access.
  f.env.DIRECTORY = { fetch: () => new Promise(() => {}) }
  await f.door.begin()
  let gateway = watching(appFetch(
    visit('/cookbook/', {
      headers: { cookie: 'yak_session=not-a-session' },
    }),
    f.env,
  ))
  await f.deadlines()
  return {
    first: first.status,
    pass: pass.status,
    pending: gateway.pending(),
    files: f.fileReads(),
  }
})()
test('directory serving: private and credentialed gateway access waits for authority', () => {
  equal(privatePage, { first: 204, pass: 204, pending: true, files: 0 })
})

// An app's address without its slash forwards to it, the same for everyone
// who may read the app, so Site keeps the forward as it keeps the page.
let forwards = []
for (let access of ['public', 'open', 'private'] as const) {
  let answer = await fixture(access).site('/cookbook')
  forwards.push([
    access,
    answer.status,
    answer.headers.get('location'),
    answer.headers.get('cache-tag'),
  ])
}
test("directory serving: Site keeps a readable app's forward to its slash", () => {
  equal(forwards, [
    ['public', 302, '/cookbook/', 'app:a,space:s'],
    ['open', 302, '/cookbook/', 'app:a,space:s'],
    ['private', 204, null, null],
  ])
})

// A space with no front page lists its apps at `/`. A stranger's listing is
// the same for every stranger, so Site keeps it under the space's tag, and
// it names no private app and no app before its first release.
let listings = []
for (let access of ['public', 'private'] as const) {
  for (let version of [1, 0]) {
    let f = fixture(access)
    f.rows[1].app!.version = version
    let answer = await f.site('/')
    listings.push([
      access,
      version,
      answer.status,
      answer.headers.get('cache-tag'),
      JSON.parse(answer.headers.get(SEEN) ?? 'null'),
      (await answer.text()).includes('href="/cookbook/"'),
    ])
  }
}
test("directory serving: Site keeps a space's index as a stranger sees it", () => {
  let stranger = { space: 'ada', stranger: true }
  equal(listings, [
    ['public', 1, 200, 'space:s', stranger, true],
    ['public', 0, 200, 'space:s', stranger, false],
    ['private', 1, 200, 'space:s', stranger, false],
    ['private', 0, 200, 'space:s', stranger, false],
  ])
})

// A person signed in is shown the index as Site keeps it at their session's
// key: an outsider's, the private app unnamed, while they hold no seat; a
// member's never; and a key whose cookie is not its session is nobody's.
let SECRET = 'a session secret'
let sessionOf = (person: string) =>
  sign({ person, space: null, exp: Date.now() / 1000 + 3600, via: 'v' }, SECRET)
let [outsider, owner] = await Promise.all(['p', 'o'].map(sessionOf))
let seated = []
for (let [key, cookie] of [[outsider], [owner], [outsider, owner]]) {
  let f = fixture('private')
  f.env.SESSION_SECRET = SECRET
  f.rows.push({
    entity: { eid: 'm' },
    member: { space: 's', person: 'o', role: 'owner' },
  })
  let answer = await siteFetch(
    new Request(pageAt('ada.yaks.app', '/', null, key), {
      headers: { cookie: `yak_session=${cookie ?? key}` },
    }),
    f.env,
  )
  seated.push([
    answer.status,
    answer.headers.get('cache-tag'),
    JSON.parse(answer.headers.get(SEEN) ?? 'null'),
    (await answer.text()).includes('href="/cookbook/"'),
  ])
}
test("directory serving: Site keeps a person's index only while they hold no seat", () => {
  equal(seated, [
    [200, 'space:s', { space: 'ada', outsider: true }, false],
    [204, null, null, false],
    [204, null, null, false],
  ])
})

// An app's page is kept the same way: as a stranger sees it, and at a
// signed-in person's key only while they hold no seat. A member's is theirs
// (a writer's wears the pencil, public/edit.js), so it is never kept.
let appSeated = []
for (let key of [undefined, outsider, owner]) {
  let f = fixture('public')
  f.env.SESSION_SECRET = SECRET
  f.rows.push({
    entity: { eid: 'm' },
    member: { space: 's', person: 'o', role: 'owner' },
  })
  let answer = await siteFetch(
    new Request(pageAt('ada.yaks.app', '/cookbook/', null, key), {
      headers: key ? { cookie: `yak_session=${key}` } : {},
    }),
    f.env,
  )
  await answer.body?.cancel()
  appSeated.push([
    answer.status,
    JSON.parse(answer.headers.get(SEEN) ?? 'null'),
  ])
}
test("directory serving: Site keeps an app's page for strangers and outsiders, never a member's", () => {
  equal(
    appSeated.map(([status, seen]) => [status, seen?.stranger, seen?.outsider]),
    [
      [200, true, undefined],
      [200, undefined, true],
      [204, undefined, undefined],
    ],
  )
})

// The gateway's own forward, a private app's, takes the visitor's query with
// it, so a shared link's `ref` or an ad's `utm_*` reaches the page.
let carried = await appFetch(
  visit('/cookbook?utm_source=x'),
  fixture('private').env,
)
test("directory serving: an app's forward to its slash keeps the query", () => {
  equal(
    [carried.status, carried.headers.get('location')],
    [302, '/cookbook/?utm_source=x'],
  )
})

// A published app's release files are anyone's: installing it hands them out
// (directory.ts `offered`). So Site keeps them even for a private app, whose
// pages and data it never keeps, and an unpublished private app's stay behind
// its access check.
let RELEASE = 'fdcc9a38-0b6b-4f8c-bcbd-15bad97cee69'
let kept = async (published?: Row['published']) => {
  let f = fixture('private', {
    source: `ada/.releases/a/${RELEASE}`,
    published,
  })
  let answers = []
  for (
    let path of [
      `/cookbook/api/assets/${RELEASE}/style.css`,
      '/cookbook/api/client.js',
      '/cookbook/',
      '/cookbook/api/me',
    ]
  ) {
    let answer = await f.site(path)
    await answer.body?.cancel()
    answers.push([answer.status, answer.headers.get('cache-tag')])
  }
  return answers
}
let offer = { name: 'cookbook', version: 1, at: '', about: '' }
let [published, unpublished] = [await kept(offer), await kept()]
test("directory serving: Site keeps a published private app's release files, never its pages", () => {
  equal(published, [
    [200, 'app:a,space:s'],
    [200, 'app:a,space:s'],
    [204, null],
    [204, null],
  ])
})
test("directory serving: an unpublished private app's release files pass to the gateway", () => {
  equal(unpublished, [[204, null], [204, null], [204, null], [204, null]])
})

let mutationCopy = copyFixture()
let p = platform({
  SERVING_COPY: { idFromName: (name) => name, get: () => mutationCopy.door },
})
let warm = await seeded(p.env)
let mutations = directory({ fetch: (req) => dirPart.fetch(req, p.env) })
await mutations.stamp({
  entities: [{
    entity: { eid: warm.app.eid },
    app: { worker: '', source: 'one' },
  }],
}, ADA_OWNS)

for (
  let [name, patch] of [
    ['setting', { theme: { theme_color: '#123456' } }],
    ['deploy', { app: { version: 2, source: 'two' } }],
    ['privacy', { app: { access: 'private' } }],
  ] as const
) {
  let f = fixture()
  let time = clock()
  f.env.DIRECTORY = { fetch: (req) => dirPart.fetch(req, p.env) }
  f.env.SERVING_COPY = {
    idFromName: (name) => name,
    get: () => mutationCopy.door,
  }
  f.env.CLOCK = time
  let previous = await (await f.page()).text()
  await continuations()
  let old = mutationCopy.puts.slice(-1)
  let before = mutationCopy.copy.revision
  // A deploy selects server-owned release fields, so use the trusted door.
  await mutations.stamp({
    entities: [{ entity: { eid: warm.app.eid }, ...patch }],
  }, ADA_OWNS)
  let after = mutationCopy.copy.revision
  let late = await Promise.all(
    old.map(([revision, key, body]) =>
      mutationCopy.door.put(revision, key, body)
    ),
  )
  f.env.DIRECTORY = { fetch: () => new Promise(() => {}) }
  let read = watching(f.page())
  await continuations()
  await time.advance(STALL)
  await continuations()
  let pending = read.pending()
  // A fresh read after the write publishes the new declaration, not old rows.
  let current = (await mutations.app(warm.space, warm.app.slug))!
  f.env.DIRECTORY = { fetch: (req) => dirPart.fetch(req, p.env) }
  let recovered = await f.page()
  let body = await recovered.text()
  let status = recovered.status
  test(`directory serving: ${name} commits fence previously known page routing`, () => {
    equal(old.length, 1)
    ok(after > before)
    equal(late, [false])
    ok(pending, 'a committed mutation must not resurrect old routing')
    if (name == 'setting') {
      equal(current.theme?.themeColor, '#123456')
      equal(status, 200)
    }
    if (name == 'deploy') {
      equal([current.version, current.source], [2, 'two'])
      equal(status, 200)
      ok(body !== previous, 'Apps must select the new release bytes')
    }
    if (name == 'privacy') {
      equal(current.access, 'private')
      equal([status, body], [204, ''])
    }
  })
}
await p[Symbol.asyncDispose]()
