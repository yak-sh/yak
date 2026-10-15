// The serving seam, not a second renderer: Apps and Site read the real typed
// directory client through a bound door. Only the directory transport and file
// storage are fixtures. The copy and its deadline are the production ones.
import { clock, equal, ok, test } from '@yaks/testing'
import { edged, fetch as appFetch } from './apps.ts'
import { directory, type Row } from './directory.ts'
import * as dirPart from './directory.ts'
import {
  EPOCH,
  publicDirectory,
  type ServingCopyDoor,
} from './directory-copy.ts'
import type { Env } from './env.ts'
import { pageAt } from './page-cache.ts'
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
  for (let n = 0; n < 64; n++) await Promise.resolve()
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

let fixture = (access: 'public' | 'open' | 'private' = 'public') => {
  let time = clock()
  let f = copyFixture()
  let rows: Row[] = [
    { entity: { eid: 's' }, space: { slug: 'ada' } },
    {
      entity: { eid: 'a' },
      app: {
        slug: 'cookbook',
        space: 's',
        access,
        version: 1,
        source: 'one',
        worker: '',
      },
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
        q.startsWith('.space.slug=') ? [rows[0]] : [rows[1]],
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
  let wrap = () => env.DIRECTORY = publicDirectory(via, f.door, time)
  // Apps sees its normal DIRECTORY binding, already deadline-wrapped. No
  // SERVING_COPY here: Apps must not install a second, real-time wrapper.
  let env = {
    DIRECTORY: undefined,
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
  } as unknown as Env
  wrap()
  return {
    ...f,
    env,
    rows,
    reads: () => reads,
    fileReads: () => fileReads,
    stall: () => {
      stalled = true
      wrap()
    },
    // Both sequential reads share one request deadline. Once space resumes,
    // run the routing timer at the same instant, without another 25ms wait.
    deadlines: async () => {
      await continuations()
      await time.advance(25)
      await continuations()
      await time.advance(0)
      await continuations()
    },
    page: () => edged(visit('/cookbook/'), env),
    site: () =>
      siteFetch(new Request(pageAt('ada.yaks.app', '/cookbook/', null)), env),
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
test('directory serving: a known public page answers within 25ms when DIRECTORY never does', () => {
  equal(publicPage.fills, 2)
  ok(publicPage.waited)
  equal([publicPage.status, publicPage.got], [200, publicPage.body])
  equal(publicPage.reads, 4)
  equal(publicPage.files, 2) // Rendered anew, not an old page response.
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
  equal(unavailable, [{ pending: true, files: 0 }, { pending: true, files: 1 }])
})

let privatePage = await (async () => {
  let f = fixture('private')
  let first = await f.page()
  await continuations()
  f.stall()
  let edge = watching(f.page())
  await f.deadlines()
  let pass = edge.answer()
  // The pass is not a page. Apps.fetch, where signed-in/private access is
  // actually decided, must still await the authoritative directory binding.
  f.env.DIRECTORY = { fetch: () => new Promise(() => {}) }
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

let mutationCopy = copyFixture()
let p = platform({
  SERVING_COPY: { idFromName: (name) => name, get: () => mutationCopy.door },
})
let warm = await seeded(p.env)
let mutations = directory({ fetch: (req) => dirPart.fetch(req, p.env) }, true)
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
  f.env.DIRECTORY = publicDirectory(
    { fetch: (req) => dirPart.fetch(req, p.env) },
    mutationCopy.door,
    time,
  )
  let previous = await (await f.page()).text()
  await continuations()
  let old = mutationCopy.puts.slice(-2)
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
  f.env.DIRECTORY = publicDirectory(
    { fetch: () => new Promise(() => {}) },
    mutationCopy.door,
    time,
  )
  let read = watching(f.page())
  await continuations()
  await time.advance(25)
  await continuations()
  let pending = read.pending()
  // A fresh read after the write publishes the new declaration, not old rows.
  let current = (await mutations.app(warm.space, warm.app.slug))!
  f.env.DIRECTORY = publicDirectory(
    { fetch: (req) => dirPart.fetch(req, p.env) },
    mutationCopy.door,
    time,
  )
  let recovered = await f.page()
  let body = await recovered.text()
  let status = recovered.status
  test(`directory serving: ${name} commits fence previously known page routing`, () => {
    equal(old.length, 2)
    ok(after > before)
    equal(late, [false, false])
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
