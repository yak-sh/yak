// What a version has to promise, held on the seam: the manifest names paths
// and shas and never bytes, the bytes it names are still there when a rollback
// asks for them however many deploys later, and what comes back is byte for
// byte what went out — the app's own code included. The whole tool is held in
// workerd beside it (mcp_test.ts, "a deploy is a version, and one word puts
// it back"); a dispatch namespace has no local implementation, so the worker's
// last hop is proved here against the same stubbed account API dispatch_test.ts
// uses.
import { assert, assertEquals } from '@std/assert'
import type { Blobs } from '../../src/blobs.ts'
import { counted } from '../../src/store/blobs.ts'
import type { Tally } from '../../src/hops.ts'
import type { App, Directory } from './directory.ts'
import { carried, upload } from './dispatch.ts'
import type { Env } from './env.ts'
import type { Plugin } from './plugin.ts'
import type { Who } from './session.ts'
import {
  addressed,
  GRACE,
  held,
  history,
  KEEP,
  moved,
  own,
  pinned,
  type Pinner,
  pins,
  pruned,
  record,
  replaced,
  restore,
  restored,
  SHA,
  sha256,
  snapshot,
  type Version,
  whatChanged,
} from './versions.ts'

let PREFIX = 'jeff/recipes/'
let WHO: Who = { person: 'p1', role: 'owner' }
let APP = { eid: 'a1', slug: 'recipes', version: 0 } as App
// The sweep reads the referrers of every app in the bucket at once, so even one
// app is handed as a list.
let ONE: Pinner[] = [{ prefix: PREFIX, app: APP }]

// The blob seam in memory: no I/O, so the fast tier stays fast. `at` is when
// each object landed, which the sweep's grace period reads — `clock` moves it,
// so a test can put bytes that look a day old.
//
// It is COUNTED by the platform's own counter (blobs.ts `counted`), told this
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
      get: (k) => {
        let v = m.get(k)
        if (!v) throw new Error(`no blob at ${k}`)
        return Promise.resolve(v as Uint8Array<ArrayBuffer>)
      },
      delete: (k) => {
        m.delete(k)
        at.delete(k)
        return Promise.resolve()
      },
      list: (prefix) => Promise.resolve(keys(prefix)),
      uploaded: (prefix) =>
        Promise.resolve(
          Object.fromEntries(keys(prefix).map((k) => [k, at.get(k) ?? 0])),
        ),
    } satisfies Blobs,
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
let read = async (blobs: Blobs, path: string) =>
  new TextDecoder().decode(await blobs.get(PREFIX + path))

// The deploy rows, in memory: the two questions `record` asks of the
// directory — write a bundle, read the app's versions back.
type Entity = {
  entity?: { eid: string }
  deploy?: { app: string; version: number; files: string; worker: string }
  tombstone?: unknown
}

let directory = () => {
  let rows: (Version & { app: string })[] = []
  let dir = {
    // Per app, because the sweep now marks from every app in the bucket and
    // what one names has to be tellable from what another does.
    deploys: (app: App) =>
      Promise.resolve(
        rows.filter((r) => r.app == app.eid)
          .sort((a, b) => b.version - a.version),
      ),
    apply: (m: { entities: Entity[] }) => {
      for (let e of m.entities) {
        if (e.deploy) {
          rows.push({
            app: e.deploy.app,
            eid: `d${e.deploy.app}-${e.deploy.version}`,
            version: e.deploy.version,
            at: '',
            files: JSON.parse(e.deploy.files),
            worker: e.deploy.worker,
          })
        }
        if (e.tombstone) rows = rows.filter((r) => r.eid != e.entity!.eid)
      }
      return Promise.resolve({ changes: [] })
    },
  } as unknown as Directory
  return { dir, rows: () => rows }
}

Deno.test('a manifest names paths and shas, not the bytes', async () => {
  let { blobs, trips } = memory()
  await blobs.put(PREFIX + 'index.html', bytes('<h1>one</h1>'))
  await blobs.put(PREFIX + 'style.css', bytes('body{}'))
  // What the platform keeps beside the app's files is not the app's files.
  await blobs.put(PREFIX + 'blobs/deadbeef', bytes('a photo'))
  let before = trips()
  let files = await snapshot(blobs, PREFIX)
  assertEquals(Object.keys(files).sort(), ['index.html', 'style.css'])
  assert(/^[0-9a-f]{64}$/.test(files['index.html']), 'a sha, not the text')
  // What a deploy costs the bucket, and what the global key must never make
  // dearer (T-34953): one listing, then per file one get, one head and — only
  // where the object is new — one put.
  let cost = trips()
  assertEquals(
    {
      list: cost.list - before.list,
      get: cost.get - before.get,
      has: cost.has - before.has,
      put: cost.put - before.put,
    },
    { list: 1, get: 2, has: 2, put: 2 },
  )

  // The bytes are pinned once, at their own name, so an unchanged file across
  // two deploys is one object — and the second deploy pays the head and no put.
  let mid = trips()
  let again = await snapshot(blobs, PREFIX)
  assertEquals(again, files)
  assertEquals(trips().has - mid.has, 2)
  assertEquals(trips().put - mid.put, 0)
  assertEquals((await blobs.list(SHA)).length, 2)
  assertEquals(own(['index.html', 'blobs/x', 'versions/y']), ['index.html'])
})

Deno.test('a rollback restores the bytes, and only the files', async () => {
  let { blobs } = memory()
  await blobs.put(PREFIX + 'index.html', bytes('<h1>one</h1>'))
  await blobs.put(PREFIX + 'worker.js', bytes('export default { fetch: one }'))
  await blobs.put(
    PREFIX + 'vocab.json',
    bytes('{"recipe":{"serves":"number"}}'),
  )
  let one = await snapshot(blobs, PREFIX)

  // The deploy that broke it: a changed page, a changed worker, a new file.
  await blobs.put(PREFIX + 'index.html', bytes('<h1>OOPS</h1>'))
  await blobs.put(PREFIX + 'worker.js', bytes('export default { fetch: two }'))
  await blobs.put(PREFIX + 'broken.js', bytes('throw new Error("no")'))
  await blobs.put(PREFIX + 'blobs/deadbeef', bytes('a photo'))
  let two = await snapshot(blobs, PREFIX)
  assertEquals(
    whatChanged(one, two),
    'added broken.js, changed index.html, worker.js',
  )

  await restore(blobs, PREFIX, one)
  assertEquals(await read(blobs, 'index.html'), '<h1>one</h1>')
  assertEquals(await read(blobs, 'worker.js'), 'export default { fetch: one }')
  assertEquals(
    await read(blobs, 'vocab.json'),
    '{"recipe":{"serves":"number"}}',
  )
  // What that version did not name is gone, and what was never a file of the
  // app's — a photo someone uploaded — is untouched.
  assertEquals(await blobs.has(PREFIX + 'broken.js'), false)
  assertEquals(await read(blobs, 'blobs/deadbeef'), 'a photo')
  // And the version it rolled FORWARD from is still restorable: history is
  // never rewritten, so its bytes are still pinned.
  await restore(blobs, PREFIX, two)
  assertEquals(await read(blobs, 'index.html'), '<h1>OOPS</h1>')
})

// What a version PUT BACK, read off the manifests: a rollback restores files,
// so the files are its record (T-32910, C-32905 item 6).
Deno.test('a version made by a rollback says which one it restored', () => {
  let v = (version: number, index: string): Version => ({
    eid: `d${version}`,
    version,
    at: '',
    files: { 'index.html': index },
    worker: '',
  })
  // v1 lemon, v2 oops, v3 the rollback, v4 a deploy of the same bytes again.
  let all = [v(4, 'lemon'), v(3, 'lemon'), v(2, 'oops'), v(1, 'lemon')]
  assertEquals(restored(all, 1), 1, 'v3 put v1 back')
  assertEquals(restored(all, 2), 0, 'v2 is its own change')
  assertEquals(restored(all, 3), 0, 'the first deploy put nothing back')
  // A deploy that changed nothing is not a rollback, whatever it matches.
  assertEquals(restored(all, 0), 0, 'v4 changed nothing')
})

// The retention rule (T-34952): a version is kept forever, because git derives
// an app's commit chain from the manifests, and its bytes are kept as long as
// it is — so the oldest rollback an app offers works however many deploys
// later.
Deno.test('no version is ever buried, and every one keeps its bytes', async () => {
  let { blobs, clock } = memory()
  let { dir, rows } = directory()
  // Two days back, so nothing the sweep sees is inside its grace period.
  clock.now = Date.now() - 2 * GRACE
  // One file that never changes and one that changes every time, so each
  // version pins a byte set of its own beside a shared one.
  await blobs.put(PREFIX + 'style.css', bytes('body{}'))
  let shared = ''
  for (let n = 1; n <= KEEP + 3; n++) {
    await blobs.put(PREFIX + 'index.html', bytes(`<h1>${n}</h1>`))
    let files = await snapshot(blobs, PREFIX)
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
      assert(
        await blobs.has(addressed(sha)),
        `v${v.version}: ${sha}`,
      )
    }
  }
  assert(await blobs.has(addressed(shared)))
  // One page per version, plus the stylesheet they all share.
  assertEquals((await blobs.list(SHA)).length, KEEP + 4)
})

// The worker's last hop. A dispatch namespace is remote-only, so what a
// rollback restores is proved to reach Cloudflare the way dispatch_test.ts
// proves an upload: against the account API, stubbed.
Deno.test('the worker a rollback put back is the source uploaded', async () => {
  let { blobs } = memory()
  await blobs.put(PREFIX + 'worker.js', bytes('export default { fetch: one }'))
  let one = await snapshot(blobs, PREFIX)
  await blobs.put(PREFIX + 'worker.js', bytes('export default { fetch: two }'))
  await snapshot(blobs, PREFIX)
  await restore(blobs, PREFIX, one)

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
      await carried((path) => blobs.read(PREFIX + path)),
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

// ---- what a write replaced (T-34508) ---------------------------------------

let ago = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000)

Deno.test('a write pins what it replaced, and a path answers its own past', async () => {
  let { blobs } = memory()
  // A file that did not exist has no previous version, and nothing is written
  // down about it.
  assertEquals(await replaced(blobs, PREFIX, 'index.html', 'p1'), null)
  assertEquals(await history(blobs, PREFIX, 'index.html'), [])

  await blobs.put(PREFIX + 'index.html', bytes('<h1>one</h1>'))
  let was = await replaced(blobs, PREFIX, 'index.html', 'p1', ago(2))
  await blobs.put(PREFIX + 'index.html', bytes('<h1>two</h1>'))
  assertEquals(was!.size, 12)
  assertEquals(was!.by, 'p1')
  // The bytes are pinned by their content, so the history can hand them back.
  assertEquals(
    new TextDecoder().decode(await blobs.get(addressed(was!.sha))),
    '<h1>one</h1>',
  )

  let then = await replaced(blobs, PREFIX, 'index.html', 'p2', ago(1))
  await blobs.put(PREFIX + 'index.html', bytes('<h1>three</h1>'))
  let all = await history(blobs, PREFIX, 'index.html')
  // Newest first: the last thing it was is the first thing offered back.
  assertEquals(all.map((w) => w.sha), [then!.sha, was!.sha])

  // What it held at a moment is the bytes the first write AFTER that moment
  // took away.
  assertEquals(held(all, ago(3).getTime())!.sha, was!.sha)
  assertEquals(held(all, ago(1.5).getTime())!.sha, then!.sha)
  // And nothing at all once no write has happened since: the file already is
  // what it was.
  assertEquals(held(all, Date.now()), null)

  // A path's history is not one of the app's files, so nothing lists it, no
  // deploy snapshots it and no install carries it.
  assertEquals(Object.keys(await snapshot(blobs, PREFIX)), ['index.html'])
})

Deno.test('the prune lets go only of bytes nothing names any more', async () => {
  let { blobs, clock } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE
  // One deploy, so a version names the page it went out with.
  await blobs.put(PREFIX + 'index.html', bytes('<h1>shipped</h1>'))
  let one = await snapshot(blobs, PREFIX)
  await record(dir, WHO, APP, 1, one, '')

  // Then two writes over it, forty days apart, so one entry is inside the
  // window and one is well outside it.
  let old = await replaced(blobs, PREFIX, 'index.html', 'p1', ago(40))
  await blobs.put(PREFIX + 'index.html', bytes('<h1>middle</h1>'))
  let recent = await replaced(blobs, PREFIX, 'index.html', 'p1', ago(1))
  await blobs.put(PREFIX + 'index.html', bytes('<h1>now</h1>'))
  // The forty-day-old entry names the DEPLOYED bytes, which is the case that
  // matters: an entry aging out must not take a version's bytes with it.
  assertEquals(old!.sha, one['index.html'])

  // KEEP is a floor under the age, so nothing goes while there are only two.
  assertEquals(await pruned(dir, blobs, ONE), 0)
  assertEquals((await history(blobs, PREFIX, 'index.html')).length, 2)

  // Past KEEP, the old entry ages out — and its bytes stay, because the kept
  // version still names them.
  for (let i = 0; i < KEEP; i++) {
    await replaced(blobs, PREFIX, 'index.html', 'p1', ago(1))
    await blobs.put(PREFIX + 'index.html', bytes(`<h1>${i}</h1>`))
  }
  await pruned(dir, blobs, ONE)
  let all = await history(blobs, PREFIX, 'index.html')
  // The newest KEEP, plus everything inside the thirty days — which is the
  // day-old one sitting just past KEEP, and not the forty-day-old one.
  assertEquals(all.length, KEEP + 1)
  assertEquals(all[KEEP].sha, recent!.sha)
  assertEquals(all.some((w) => w.at == old!.at), false)
  assert(await blobs.has(addressed(old!.sha)), 'the deploy still names it')
  assert(await blobs.has(addressed(recent!.sha)), 'inside the window')

  // And what is left pinned is exactly what something names: nothing is kept
  // for its own sake.
  let named = new Set([...all.map((w) => w.sha), ...Object.values(one)])
  for (let key of await blobs.list(SHA)) {
    assert(named.has(key.slice(SHA.length)), key)
  }
})

// The liveness rule itself (T-34952, D-34942): what keeps a blob is that
// something NAMES it, and never how recent it is — plus the day's grace that
// keeps a deploy still in flight from being swept out from under.
Deno.test('a blob lives while anything names it, and a day besides', async () => {
  let { blobs, clock, trips } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE

  // The first deploy, then enough after it that v1 is far past the page a
  // version list shows.
  await blobs.put(PREFIX + 'index.html', bytes('<h1>v1</h1>'))
  let one = await snapshot(blobs, PREFIX)
  await record(dir, WHO, APP, 1, one, '')
  for (let n = 2; n <= KEEP + 3; n++) {
    await blobs.put(PREFIX + 'index.html', bytes(`<h1>v${n}</h1>`))
    await record(dir, WHO, APP, n, await snapshot(blobs, PREFIX), '')
  }

  // Bytes whose referrer is gone — an entry that aged out, a deploy that died
  // before its row — and bytes a plugin still points at.
  let orphan = 'a'.repeat(64)
  let kept = 'b'.repeat(64)
  await blobs.put(addressed(orphan), bytes('nobody names these'))
  await blobs.put(addressed(kept), bytes('a plugin does'))
  // And a deploy landing right now: its bytes are in the bucket, its row is
  // not written yet, so nothing names them at all.
  clock.now = Date.now() - 60 * 60_000
  let flight = 'c'.repeat(64)
  await blobs.put(addressed(flight), bytes('a deploy still in flight'))

  let holder: Plugin = { name: 'holder', pins: [() => [kept]] }
  let before = trips()
  assertEquals(await pruned(dir, blobs, ONE, Date.now(), [holder]), 1)
  assertEquals(await blobs.has(addressed(orphan)), false)
  assert(await blobs.has(addressed(flight)), 'inside the day')
  assert(await blobs.has(addressed(kept)), 'a plugin names it')
  assert(
    await blobs.has(addressed(one['index.html'])),
    'v1 is past the page and still restorable',
  )

  // What the sweep costs an app: two listings of the bucket — the path logs
  // and the pinned bytes — one read per log, and one delete per blob let go.
  let cost = trips()
  assertEquals(cost.list - before.list, 2)
  assertEquals(cost.read - before.read, 0)
  assertEquals(cost.delete - before.delete, 1)
})

// The third thing that can name a blob (plugin.ts `pins`): a domain holding
// its own pinned bytes, which neither a manifest nor a path's history says.
Deno.test('a plugin names bytes, and the sweep keeps them', async () => {
  let { blobs, clock } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE
  await blobs.put(PREFIX + 'index.html', bytes('<h1>one</h1>'))
  // A write far outside the window, then KEEP writes after it, so its entry
  // ages out of the history and no version names its bytes either.
  let old = await replaced(blobs, PREFIX, 'index.html', 'p1', ago(40))
  await blobs.put(PREFIX + 'index.html', bytes('<h1>two</h1>'))
  for (let i = 0; i < KEEP; i++) {
    await replaced(blobs, PREFIX, 'index.html', 'p1', ago(1))
    await blobs.put(PREFIX + 'index.html', bytes(`<h1>${i}</h1>`))
  }
  let pinner: Plugin = {
    name: 'pinner',
    pins: [(at) => at.app.eid == APP.eid ? [old!.sha] : []],
  }
  assertEquals(await pruned(dir, blobs, ONE, Date.now(), [pinner]), 0)
  assert(await blobs.has(addressed(old!.sha)), 'a plugin names it')
  // And nothing is kept for its own sake: with nobody naming them, the same
  // bytes go on the next sweep.
  assertEquals(await pruned(dir, blobs, ONE, Date.now(), []), 1)
  assertEquals(await blobs.has(addressed(old!.sha)), false)
})

Deno.test('a history that cannot be read is a history with nothing in it', async () => {
  let { blobs } = memory()
  await blobs.put(PREFIX + 'history/index.html.json', bytes('{ not json'))
  await blobs.put(PREFIX + 'index.html', bytes('<h1>one</h1>'))
  // The write still lands and still keeps what it replaced: losing the
  // sentence about the bytes must never take the bytes with it.
  let was = await replaced(blobs, PREFIX, 'index.html', 'p1')
  assertEquals((await history(blobs, PREFIX, 'index.html'))[0].sha, was!.sha)
})

// ---- one key space for the whole bucket (T-34953, D-34942) -----------------

Deno.test('two apps holding the same file hold one object', async () => {
  let { blobs } = memory()
  let theirs = 'ada/recipes/'
  await blobs.put(PREFIX + 'index.html', bytes('<h1>hello</h1>'))
  await blobs.put(theirs + 'index.html', bytes('<h1>hello</h1>'))
  let mine = await snapshot(blobs, PREFIX)
  let yours = await snapshot(blobs, theirs)
  assertEquals(mine['index.html'], yours['index.html'])
  // The address is the key, so the second deploy's pin IS the first one's.
  assertEquals(await blobs.list(SHA), [addressed(mine['index.html'])])
  // And each app still puts its own copy back from it.
  await blobs.delete(theirs + 'index.html')
  await restore(blobs, theirs, yours)
  assertEquals(
    new TextDecoder().decode(await blobs.get(theirs + 'index.html')),
    '<h1>hello</h1>',
  )
})

Deno.test('a pin at the old per-app key is read until it is carried', async () => {
  let { blobs } = memory()
  // The bucket as it stands before the migration: bytes under the app's own
  // `versions/` prefix, and nothing at all under `sha/`.
  let sha = await sha256(bytes('<h1>one</h1>'))
  await blobs.put(pinned(PREFIX, sha), bytes('<h1>one</h1>'))
  assertEquals(await blobs.list(SHA), [])

  let store = pins(blobs, PREFIX)
  assert(await store.has(sha), 'the fallback finds it')
  assertEquals(
    new TextDecoder().decode((await store.get(sha))!),
    '<h1>one</h1>',
  )
  // Which is the whole point: a rollback onto a version pinned before the move
  // still works, so nothing 404s while the migration runs.
  await restore(blobs, PREFIX, { 'index.html': sha })
  assertEquals(await read(blobs, 'index.html'), '<h1>one</h1>')
})

// The mark set is the BUCKET's: an object one app has stopped naming may be
// the very file another app serves, so a sweep that saw one app at a time
// would delete it.
Deno.test('the sweep keeps a sha another app still names', async () => {
  let { blobs, clock } = memory()
  let { dir } = directory()
  clock.now = Date.now() - 2 * GRACE
  let theirs = 'ada/recipes/'
  let THEIRS = { eid: 'a2', slug: 'recipes', version: 0 } as App

  // Both apps serve the same page; only the first has deployed it, so only its
  // manifest names the one object the two share.
  await blobs.put(PREFIX + 'index.html', bytes('<h1>shared</h1>'))
  await blobs.put(theirs + 'index.html', bytes('<h1>shared</h1>'))
  let mine = await snapshot(blobs, PREFIX)
  await record(dir, WHO, APP, 1, mine, '')
  await snapshot(blobs, theirs)
  let sha = mine['index.html']

  let both: Pinner[] = [...ONE, { prefix: theirs, app: THEIRS }]
  assertEquals(await pruned(dir, blobs, both, Date.now()), 0)
  assert(await blobs.has(addressed(sha)), 'the other app names it')
  // And the same sweep with the naming app left out is the per-app sweep this
  // replaced: it would take the second app's page out from under it.
  assertEquals(
    await pruned(dir, blobs, [{ prefix: theirs, app: THEIRS }], Date.now()),
    1,
  )
})

Deno.test('the migration carries the old key across, once', async () => {
  let { blobs } = memory()
  let one = await sha256(bytes('<h1>one</h1>'))
  let two = await sha256(bytes('<h1>two</h1>'))
  await blobs.put(pinned(PREFIX, one), bytes('<h1>one</h1>'))
  await blobs.put(pinned(PREFIX, two), bytes('<h1>two</h1>'))

  // A dry run counts what a run would carry and writes nothing at all.
  assertEquals(await moved(blobs, PREFIX, true), 2)
  assertEquals(await blobs.list(SHA), [])
  assertEquals((await blobs.list(`${PREFIX}versions/`)).length, 2)

  assertEquals(await moved(blobs, PREFIX), 2)
  assertEquals(await blobs.list(SHA), [addressed(one), addressed(two)].sort())
  assertEquals(await blobs.list(`${PREFIX}versions/`), [])
  // Idempotent: a pass over an app already carried has nothing to do.
  assertEquals(await moved(blobs, PREFIX), 0)

  // Resumable, because each object is its own step: an old key whose bytes are
  // already global is only a key to drop, and a key that lies about its content
  // is left exactly where it is rather than published under a name it has not.
  await blobs.put(pinned(PREFIX, one), bytes('<h1>one</h1>'))
  let liar = 'd'.repeat(64)
  await blobs.put(pinned(PREFIX, liar), bytes('not what the key says'))
  assertEquals(await moved(blobs, PREFIX), 1)
  assertEquals(await blobs.list(`${PREFIX}versions/`), [pinned(PREFIX, liar)])
})
