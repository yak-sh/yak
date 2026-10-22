// What a version has to promise, held on the seam: the manifest names paths
// and shas and never bytes, the bytes it names are still there when a rollback
// asks for them however many deploys later, and what comes back is byte for
// byte what went out — the app's own code included. The whole tool is held
// through the kernel beside it (mcp_test.ts, "a deploy is a version, and one word puts
// it back"); a dispatch namespace has no local implementation, so the worker's
// last hop is proved here against the same stubbed account API dispatch_test.ts
// uses.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { backoff } from '@yaks/durable-object'
import type { Objects } from '@yaks/blob'
import { counted } from './lib/objects.ts'
import { releaseFiles, staged } from './release.ts'
import type { Tally } from './lib/hops.ts'
import * as dirPart from './directory.ts'
import type { App, Directory, Space } from './directory.ts'
import { type Namespace, PLATFORM_STORE } from './door.ts'
import { carried, upload } from './dispatch.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { lasting } from './testing.ts'
import {
  addressed,
  type Files,
  GRACE,
  KEEP,
  type Pinner,
  record,
  SHA,
  sha256,
  type Version,
  whatChanged,
} from './versions.ts'
import { newest, pruned, type Written } from './written.ts'

let PREFIX = 'jeff/recipes/'
let WHO: Who = { person: 'p1', role: 'owner' }
let APP = { eid: 'a1', slug: 'recipes', version: 0 } as App
// The sweep reads the referrers of every app in the bucket at once, so even one
// app is handed as a list.
let ONE: Pinner[] = [{ prefix: PREFIX, app: APP }]

// The blob seam in memory: no I/O, so the test stays fast. `at` is when
// each object landed, which the sweep's grace period reads — `clock` moves it,
// so a test can put bytes that look a day old.
//
// It is counted by the platform's own counter (lib/objects.ts `counted`), told this
// test's tally rather than a request's, so what the numbers below assert is
// what a deploy reports as `r2;dur=<n>` on its Server-Timing — one truth, and
// not a second tally that can drift from it. `trips()` is a snapshot, so a
// case says what one gesture cost by subtracting.
let memory = () => {
  let m = new Map<string, Uint8Array>()
  let at = new Map<string, number>()
  let clock = { now: Date.now() }
  let tally: Tally = new Map()
  let keys = (prefix: string) =>
    [...m.keys()].filter((k) => k.startsWith(prefix)).sort()
  let blobs = counted(
    {
      has: (k) => Promise.resolve(m.has(k)),
      put: (k, bytes) => {
        m.set(k, bytes)
        at.set(k, clock.now)
        return Promise.resolve()
      },
      read: (k) =>
        Promise.resolve((m.get(k) ?? null) as Uint8Array<ArrayBuffer> | null),
      load: async (k) => {
        let bytes = m.get(k)
        return bytes
          ? {
            bytes: bytes as Uint8Array<ArrayBuffer>,
            version: await sha256(new Uint8Array(bytes)),
          }
          : null
      },
      open: async (k) => {
        let bytes = m.get(k)
        return bytes
          ? {
            size: bytes.byteLength,
            version: await sha256(new Uint8Array(bytes)),
            read: (range?: { from: number; to: number }) =>
              Promise.resolve(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(
                      range ? bytes.slice(range.from, range.to + 1) : bytes,
                    )
                    controller.close()
                  },
                }),
              ),
          }
          : null
      },
      get: (k) => {
        let v = m.get(k)
        if (!v) throw new Error(`no blob at ${k}`)
        return Promise.resolve(v as Uint8Array<ArrayBuffer>)
      },
      delete: (keys) => {
        for (let k of [keys].flat()) {
          m.delete(k)
          at.delete(k)
        }
        return Promise.resolve()
      },
      list: (prefix) => Promise.resolve(keys(prefix)),
      uploaded: (prefix) =>
        Promise.resolve(
          Object.fromEntries(keys(prefix).map((k) => [k, at.get(k) ?? 0])),
        ),
    } satisfies Objects,
    tally,
  )
  let n = (verb: string) => tally.get(`r2.${verb}`) ?? 0
  let trips = () => ({
    list: n('list'),
    read: n('read'),
    get: n('get'),
    has: n('has'),
    put: n('put'),
    delete: n('delete'),
  })
  return { blobs, clock, trips }
}

let bytes = (s: string) => new TextEncoder().encode(s)

// Files as a write leaves them: each text's bytes at their address, and the
// path naming its sha.
let stored = async (blobs: Objects, files: Record<string, string>) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([path, text]) => {
        let sha = await sha256(bytes(text))
        await blobs.put(addressed(sha), bytes(text))
        return [path, sha]
      }),
    ),
  ) as Files

// The directory rows the sweep reads, in memory: deploys, and the `written`
// rows a write leaves (written.ts).
type Entity = {
  entity?: { eid: string }
  deploy?: {
    app?: string
    version?: number
    files?: string
    worker?: string
    source?: string
  }
  written?: Omit<Written, 'eid'> & { app: string }
  tombstone?: unknown
  $delete?: boolean
}

let directory = () => {
  let rows: (Version & { app: string })[] = []
  let writes: (Written & { app: string })[] = []
  let apply = (m: { entities: Entity[] }) => {
    for (let e of m.entities) {
      let eid = e.entity!.eid
      if (e.$delete) writes = writes.filter((w) => w.eid != eid)
      if (e.written) writes.push({ ...e.written, eid })
      let had = rows.find((r) => r.eid == eid)
      if (e.deploy && had) {
        if (e.deploy.files) had.files = JSON.parse(e.deploy.files)
        if (e.deploy.source) had.source = e.deploy.source
      } else if (e.deploy) {
        rows.push({
          app: e.deploy.app!,
          eid: `d${e.deploy.app}-${e.deploy.version}`,
          version: e.deploy.version!,
          at: '',
          files: JSON.parse(e.deploy.files ?? '{}'),
          worker: e.deploy.worker!,
          source: e.deploy.source ?? null,
        })
      }
      if (e.tombstone) rows = rows.filter((r) => r.eid != eid)
    }
    return Promise.resolve([])
  }
  let dir = {
    switches: () => Promise.resolve([]),
    // Per app, because the sweep now marks from every app in the bucket and
    // what one names has to be tellable from what another does.
    deploys: (app: App) =>
      Promise.resolve(
        rows.filter((r) => r.app == app.eid)
          .sort((a, b) => b.version - a.version),
      ),
    written: (app: App, draft?: string) =>
      Promise.resolve(
        writes.filter((w) => w.app == app.eid && (!draft || w.draft == draft)),
      ),
    apply,
    stamp: apply,
  } as unknown as Directory
  // One write to a path, as written.ts records it, `days` ago.
  let wrote = (
    path: string,
    sha: string | null,
    days: number,
    was = null as string | null,
  ) =>
    apply({
      entities: [{
        entity: { eid: crypto.randomUUID() },
        written: {
          app: APP.eid,
          draft: null,
          path,
          sha,
          was,
          size: null,
          at: ago(days).toISOString(),
          by: 'p1',
        },
      }],
    })
  return { dir, rows: () => rows, writes: () => newest(writes), wrote }
}

let ago = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000)

test('no version is ever buried, and every one keeps its bytes', async () => {
  let { blobs, clock } = memory()
  let { dir, rows } = directory()
  // Two days back, so nothing the sweep sees is inside its grace period.
  clock.now = Date.now() - 2 * GRACE
  // One file that never changes and one that changes every time, so each
  // version pins a byte set of its own beside a shared one.
  let shared = ''
  for (let n = 1; n <= KEEP + 3; n++) {
    let files = await stored(blobs, {
      'style.css': 'body{}',
      'index.html': `<h1>${n}</h1>`,
    })
    shared = files['style.css']
    await record(dir, WHO, APP, n, files, '')
  }
  let kept = rows()
  assertEquals(kept.length, KEEP + 3)
  assertEquals(kept.map((v) => v.version).sort((a, b) => a - b)[0], 1)
  // Every version can still be put back, the first one included.
  assertEquals(await pruned(dir, blobs, ONE), 0)
  for (let v of kept) {
    for (let sha of Object.values(v.files)) {
      assert(await blobs.has(addressed(sha)), `v${v.version}: ${sha}`)
    }
  }
  assert(await blobs.has(addressed(shared)))
  // One page per version, plus the stylesheet they all share.
  assertEquals((await blobs.list(SHA)).length, KEEP + 4)
})

test('pruning keeps the bytes the serving release names', async () => {
  let { blobs, clock } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE
  let current = 'jeff/.releases/a1/current'
  let files = await stored(blobs, { 'index.html': 'kept' })
  let release = staged(blobs, files, current)
  await release.files.put(`${current}/esbuild/app.js`, bytes('compiled'))
  await record(dir, WHO, APP, 2, await release.finish(), '')
  assertEquals(
    await pruned(dir, blobs, [{
      prefix: PREFIX,
      app: { ...APP, source: current },
    }]),
    0,
  )
  assertEquals(await blobs.has(`${current}.json`), true)
  let served = releaseFiles(blobs)
  let text = async (key: string) =>
    new TextDecoder().decode(await served.get(key))
  assertEquals(await text(`${current}/index.html`), 'kept')
  assertEquals(await text(`${current}/esbuild/app.js`), 'compiled')
})

test('published releases keep versioned bytes after newer deploys', async () => {
  let { blobs, clock } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE
  let old = 'jeff/.releases/a1/old'
  let current = 'jeff/.releases/a1/current'
  let failed = 'jeff/.releases/a1/failed'
  for (
    let [source, value] of [
      [old, 'old code'],
      [current, 'current code'],
      [failed, 'failed code'],
    ]
  ) {
    let release = staged(blobs, {}, source)
    await release.files.put(`${source}/esbuild/app.js`, bytes(value))
    await release.finish()
  }
  await dir.apply({
    entities: [
      {
        entity: { eid: 'old-deploy' },
        deploy: { app: APP.eid, version: 1, files: '{}', source: old },
      },
      {
        entity: { eid: 'current-deploy' },
        deploy: { app: APP.eid, version: 2, files: '{}', source: current },
      },
    ],
  })
  assertEquals(
    await pruned(dir, blobs, [{
      prefix: PREFIX,
      app: { ...APP, source: current },
    }]),
    1,
  )
  assertEquals(
    new TextDecoder().decode(
      await releaseFiles(blobs).get(`${old}/esbuild/app.js`),
    ),
    'old code',
  )
  assertEquals(await blobs.has(old + '.json'), true)
  assertEquals(await blobs.has(failed + '.json'), false)
  assertEquals(
    await blobs.has(addressed(await sha256(bytes('failed code')))),
    false,
  )
})

test('a deploy never changes the stored release it replaces', async () => {
  let { dir, rows } = directory()
  let old = 'jeff/.releases/a1/old'
  let next = 'jeff/.releases/a1/next'
  await dir.apply({
    entities: [{
      entity: { eid: 'old-deploy' },
      deploy: { app: APP.eid, version: 1, files: '{}', worker: '' },
    }],
  })
  await record(
    dir,
    WHO,
    { ...APP, version: 1, source: next },
    2,
    {},
    '',
    [],
    old,
  )
  assertEquals(rows().find((v) => v.version == 1)?.source, null)
  assertEquals(rows().find((v) => v.version == 2)?.source, next)
})

// The worker's last hop. A dispatch namespace is remote-only, so what a
// rollback puts back is proved to reach Cloudflare the way dispatch_test.ts
// proves an upload: against the account API, stubbed.
test('the worker a rollback put back is the source uploaded', async () => {
  let { blobs } = memory()
  let one = await stored(blobs, {
    'worker.js': 'export default { fetch: one }',
  })
  await stored(blobs, { 'worker.js': 'export default { fetch: two }' })
  // A version put back is a release of the shas its manifest names.
  let back = 'jeff/.releases/a1/back'
  let release = staged(blobs, one, back)

  let sent: FormData | null = null
  let was = globalThis.fetch
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    sent = await new Request(input as string, init).formData()
    return Response.json({
      success: true,
      errors: [],
      result: { id: 'jeff_recipes', deployment_id: 'dep-7' },
    })
  }) as typeof fetch
  try {
    // What tools.ts `released` hands the namespace: the worker.js among the
    // app's files, whichever deploy put it there, and everything it imports.
    let version = await upload(
      { CF_ACCOUNT: 'acct', CF_WORKERS_TOKEN: 'a-token' } as Env,
      'jeff/recipes',
      await carried((path) => release.files.read(`${back}/${path}`)),
    )
    // And what the deploy records beside its manifest: Cloudflare's own name
    // for the release.
    assertEquals(version, 'dep-7')
  } finally {
    globalThis.fetch = was
  }
  assertEquals(
    await (sent!.get('worker.js') as File).text(),
    'export default { fetch: one }',
  )
})

// ---- what a path has held (T-34508, T-124791) -------------------------------

test('the prune lets go only of bytes nothing names any more', async () => {
  let { blobs, clock } = memory()
  let { dir, writes, wrote } = directory()
  clock.now = Date.now() - 2 * GRACE
  // One deploy, so a version names the page it went out with, written forty
  // days ago; then two writes over it, one a day ago.
  let one = await stored(blobs, { 'index.html': '<h1>shipped</h1>' })
  await record(dir, WHO, APP, 1, one, '')
  await wrote('index.html', one['index.html'], 40)
  let { 'index.html': middle } = await stored(blobs, {
    'index.html': '<h1>middle</h1>',
  })
  await wrote('index.html', middle, 1, one['index.html'])

  // KEEP is a floor under the age, so nothing goes while there are only two.
  assertEquals(await pruned(dir, blobs, ONE), 0)
  assertEquals(writes().length, 2)

  // Past KEEP, the old write ages out, and its bytes stay, because the kept
  // version still names them.
  let was = middle
  for (let i = 0; i < KEEP; i++) {
    let { 'index.html': sha } = await stored(blobs, {
      'index.html': `<h1>${i}</h1>`,
    })
    await wrote('index.html', sha, 0.5, was)
    was = sha
  }
  await pruned(dir, blobs, ONE)
  let all = writes()
  // The newest KEEP, plus everything inside the thirty days, which is the
  // day-old one sitting just past KEEP, and not the forty-day-old one.
  assertEquals(all.length, KEEP + 1)
  assertEquals(all[KEEP].sha, middle)
  assert(await blobs.has(addressed(one['index.html'])), 'the deploy names it')
  assert(await blobs.has(addressed(middle)), 'inside the window')

  // And what is left stored is exactly what something names: nothing is kept
  // for its own sake.
  let named = new Set([...all.map((w) => w.sha), ...Object.values(one)])
  for (let key of await blobs.list(SHA)) {
    assert(named.has(key.slice(SHA.length)), key)
  }
})

// The liveness rule itself (T-34952, D-34942): what keeps a blob is that
// something names it, and never how recent it is, plus the day's grace that
// keeps a write still in flight from being swept out from under.
test('a blob lives while anything names it, and a day besides', async () => {
  let { blobs, clock, trips } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE

  // The first deploy, then enough after it that v1 is far past the page a
  // version list shows.
  let one = await stored(blobs, { 'index.html': '<h1>v1</h1>' })
  await record(dir, WHO, APP, 1, one, '')
  for (let n = 2; n <= KEEP + 3; n++) {
    let files = await stored(blobs, { 'index.html': `<h1>v${n}</h1>` })
    await record(dir, WHO, APP, n, files, '')
  }

  // Bytes whose referrer is gone: a write that aged out, a deploy that died
  // before its row.
  let orphan = 'a'.repeat(64)
  await blobs.put(addressed(orphan), bytes('nobody names these'))
  // And a write landing right now: its bytes are in the bucket, its row is
  // not written yet, so nothing names them at all.
  clock.now = Date.now() - 60 * 60_000
  let flight = 'c'.repeat(64)
  await blobs.put(addressed(flight), bytes('a write still in flight'))

  let before = trips()
  assertEquals(await pruned(dir, blobs, ONE), 1)
  assertEquals(await blobs.has(addressed(orphan)), false)
  assert(await blobs.has(addressed(flight)), 'inside the day')
  assert(
    await blobs.has(addressed(one['index.html'])),
    'v1 is past the page and still restorable',
  )

  // What the sweep costs an app: a listing of its staged releases and one of
  // the stored blobs; no read at all.
  let cost = trips()
  assertEquals(cost.list - before.list, 2)
  assertEquals(cost.read - before.read, 0)
  assertEquals(cost.delete - before.delete, 1)
})

// ---- one key space for the whole bucket (T-34953, D-34942) -----------------

// The mark set is the bucket's: an object one app has stopped naming may be
// the very file another app serves, so a sweep that saw one app at a time
// would delete it.
test('the sweep keeps a sha another app still names', async () => {
  let { blobs, clock } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE
  let theirs = 'ada/recipes/'
  let THEIRS = { eid: 'a2', slug: 'recipes', version: 0 } as App

  // Both apps hold the same page; only the first has deployed it, so only its
  // manifest names the one object the two share.
  let mine = await stored(blobs, { 'index.html': '<h1>shared</h1>' })
  await record(dir, WHO, APP, 1, mine, '')
  let sha = mine['index.html']

  let both: Pinner[] = [...ONE, { prefix: theirs, app: THEIRS }]
  assertEquals(await pruned(dir, blobs, both, Date.now()), 0)
  assert(await blobs.has(addressed(sha)), 'the other app names it')
  // And the same sweep with the naming app left out is the per-app sweep this
  // replaced: it would take the first app's page out from under it.
  assertEquals(
    await pruned(dir, blobs, [{ prefix: theirs, app: THEIRS }], Date.now()),
    1,
  )
})

test('what one version did to the one before it', () => {
  assertEquals(
    whatChanged(
      { 'index.html': 'a', 'worker.js': 'b' },
      { 'index.html': 'c', 'worker.js': 'b', 'broken.js': 'd' },
    ),
    'added broken.js, changed index.html',
  )
})

// Every platform deploy restarts every object, and a deploy being recorded
// right then must still land once (T-40726). The directory commits the batch,
// then the restart takes its answer: throws it at the caller, as the runtime
// does, or says it in a 500, as a store going away does (@yaks/api `refuse`).
let RESET = 'Durable Object reset because its code was updated.'

let lost = {
  throws: () => {
    throw Object.assign(new Error(RESET), { retryable: true })
  },
  says: () =>
    Response.json({ error: 'Error', message: RESET }, { status: 500 }),
}

// Each case owns a prepared platform. Booting the directory and seeding its
// app are fixture work; recording the deploy through a lost answer is the
// behavior timed below, still through the real Store and its retry receipt.
let restartFixture = async (answer: () => Response) => {
  let platform = lasting('a probe secret')
  let { env } = platform
  let store = env.STORE as unknown as Namespace
  let once = false
  let STORE: Namespace = {
    idFromName: (name) => name,
    get: (name) => ({
      fetch: async (req: Request) => {
        let deploy = name == PLATFORM_STORE &&
          (await req.clone().text()).includes('"deploy"')
        let r = await store.get(name).fetch(req)
        if (!deploy || once) return r
        once = true
        return answer()
      },
    }),
  }
  let restarting = { ...env, STORE } as Env
  let dir = dirPart.directory(
    { fetch: (r: Request) => dirPart.fetch(r, restarting) },
    true,
  )
  let ada = crypto.randomUUID()
  await dir.apply({
    entities: [
      { entity: { eid: ada }, person: {}, doc: { title: 'Ada' } },
      { entity: { eid: '$space' }, space: { slug: 'ada', store: 'ada' } },
      {
        entity: { eid: '$app' },
        app: { slug: 'recipes', space: '$space', version: 0 },
      },
    ],
  }, { 'x-yak-person': ada, 'x-yak-role': 'owner' })
  let space = (await dir.space('ada')) as Space
  let app = (await dir.app(space, 'recipes')) as App
  await platform.settled()
  return {
    platform,
    dir,
    space,
    app,
    who: { person: ada, role: 'owner' } as Who,
  }
}

for (let [how, answer] of Object.entries(lost)) {
  let fixture = await restartFixture(answer)
  test(`a deploy recorded as a restart ${how} its answer lands once`, async () => {
    await using _platform = fixture.platform
    // Retry timing is not this test's subject; keep the retry, not its jitter.
    let paused: number[] = []
    using _wait = stub(backoff, 'wait', (ms) => {
      paused.push(ms)
      return Promise.resolve()
    })
    let { dir, space, app, who } = fixture
    await record(dir, who, app, 1, { a: 'b' }, '')
    assertEquals((await dir.deploys(app)).map((v) => v.version), [1])
    assertEquals((await dir.app(space, 'recipes'))?.version, 1)
    assertEquals(paused, backoff.pauses.slice(0, 1))
  })
}
