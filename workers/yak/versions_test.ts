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
import type { App, Directory } from './directory.ts'
import { carried, upload } from './dispatch.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import {
  held,
  history,
  KEEP,
  own,
  pinned,
  pruned,
  record,
  replaced,
  restore,
  restored,
  snapshot,
  type Version,
  whatChanged,
} from './versions.ts'

let PREFIX = 'jeff/recipes/'
let WHO: Who = { person: 'p1', role: 'owner' }
let APP = { eid: 'a1', slug: 'recipes', version: 0 } as App

// The blob seam in memory: no I/O, so the fast tier stays fast.
let memory = () => {
  let m = new Map<string, Uint8Array>()
  let blobs: Blobs = {
    has: (k) => Promise.resolve(m.has(k)),
    put: (k, bytes) => {
      m.set(k, bytes)
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
      return Promise.resolve()
    },
    list: (prefix) =>
      Promise.resolve([...m.keys()].filter((k) => k.startsWith(prefix)).sort()),
  }
  return { blobs }
}

let bytes = (s: string) => new TextEncoder().encode(s)
let read = async (blobs: Blobs, path: string) =>
  new TextDecoder().decode(await blobs.get(PREFIX + path))

// The deploy rows, in memory: the two questions `record` asks of the
// directory — write a bundle, read the app's versions back.
type Entity = {
  entity?: { eid: string }
  deploy?: { version: number; files: string; worker: string }
  tombstone?: unknown
}

let directory = () => {
  let rows: Version[] = []
  let dir = {
    deploys: () =>
      Promise.resolve([...rows].sort((a, b) => b.version - a.version)),
    apply: (m: { entities: Entity[] }) => {
      for (let e of m.entities) {
        if (e.deploy) {
          rows.push({
            eid: `d${e.deploy.version}`,
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
  let { blobs } = memory()
  await blobs.put(PREFIX + 'index.html', bytes('<h1>one</h1>'))
  await blobs.put(PREFIX + 'style.css', bytes('body{}'))
  // What the platform keeps beside the app's files is not the app's files.
  await blobs.put(PREFIX + 'blobs/deadbeef', bytes('a photo'))
  let files = await snapshot(blobs, PREFIX)
  assertEquals(Object.keys(files).sort(), ['index.html', 'style.css'])
  assert(/^[0-9a-f]{64}$/.test(files['index.html']), 'a sha, not the text')
  // The bytes are pinned once, at their own name, so an unchanged file across
  // two deploys is one object.
  let again = await snapshot(blobs, PREFIX)
  assertEquals(again, files)
  assertEquals((await blobs.list(`${PREFIX}versions/`)).length, 2)
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

// The retention rule, which is the one that decides whether the oldest
// rollback an app still offers works at all.
Deno.test('past the last 20, only bytes no kept version names go', async () => {
  let { blobs } = memory()
  let { dir, rows } = directory()
  // One file that never changes and one that changes every time, so each
  // version pins a byte set of its own beside a shared one.
  await blobs.put(PREFIX + 'style.css', bytes('body{}'))
  let shared = ''
  for (let n = 1; n <= KEEP + 3; n++) {
    await blobs.put(PREFIX + 'index.html', bytes(`<h1>${n}</h1>`))
    let files = await snapshot(blobs, PREFIX)
    shared = files['style.css']
    await record(dir, blobs, PREFIX, WHO, APP, n, files, '')
  }
  let kept = rows()
  assertEquals(kept.length, KEEP)
  assertEquals(kept.map((v) => v.version).sort((a, b) => a - b)[0], 4)
  // Every kept version can still be put back.
  for (let v of kept) {
    for (let sha of Object.values(v.files)) {
      assert(
        await blobs.has(`${PREFIX}versions/${sha}`),
        `v${v.version}: ${sha}`,
      )
    }
  }
  // The unchanged file was named by the buried versions too, and stayed.
  assert(await blobs.has(`${PREFIX}versions/${shared}`))
  // The three pages nothing names any more did not.
  assertEquals((await blobs.list(`${PREFIX}versions/`)).length, KEEP + 1)
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
    new TextDecoder().decode(await blobs.get(pinned(PREFIX, was!.sha))),
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
  let { blobs } = memory()
  let { dir } = directory()
  // One deploy, so a version names the page it went out with.
  await blobs.put(PREFIX + 'index.html', bytes('<h1>shipped</h1>'))
  let one = await snapshot(blobs, PREFIX)
  await record(dir, blobs, PREFIX, WHO, APP, 1, one, '')

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
  assertEquals(await pruned(dir, blobs, PREFIX, APP), 0)
  assertEquals((await history(blobs, PREFIX, 'index.html')).length, 2)

  // Past KEEP, the old entry ages out — and its bytes stay, because the kept
  // version still names them.
  for (let i = 0; i < KEEP; i++) {
    await replaced(blobs, PREFIX, 'index.html', 'p1', ago(1))
    await blobs.put(PREFIX + 'index.html', bytes(`<h1>${i}</h1>`))
  }
  await pruned(dir, blobs, PREFIX, APP)
  let all = await history(blobs, PREFIX, 'index.html')
  // The newest KEEP, plus everything inside the thirty days — which is the
  // day-old one sitting just past KEEP, and not the forty-day-old one.
  assertEquals(all.length, KEEP + 1)
  assertEquals(all[KEEP].sha, recent!.sha)
  assertEquals(all.some((w) => w.at == old!.at), false)
  assert(await blobs.has(pinned(PREFIX, old!.sha)), 'the deploy still names it')
  assert(await blobs.has(pinned(PREFIX, recent!.sha)), 'inside the window')

  // And what is left pinned is exactly what something names: nothing is kept
  // for its own sake.
  let named = new Set([...all.map((w) => w.sha), ...Object.values(one)])
  for (let key of await blobs.list(`${PREFIX}versions/`)) {
    assert(named.has(key.slice(`${PREFIX}versions/`.length)), key)
  }
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
