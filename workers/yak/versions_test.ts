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
import { upload } from './dispatch.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import {
  KEEP,
  own,
  record,
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
    // What tools.ts `deployed` hands the namespace: the worker.js among the
    // app's files, whichever deploy put it there.
    let version = await upload(
      { CF_ACCOUNT: 'acct', CF_WORKERS_TOKEN: 'a-token' } as Env,
      'jeff/recipes',
      await read(blobs, 'worker.js'),
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
