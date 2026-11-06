// A release names the shas its files are, and still serves a whole app once
// the keys it was made from are gone.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Objects } from '@yaks/blob'
import { filesAt, releaseFiles, staged } from './release.ts'
import { fileBytes } from './files.ts'
import { bucket } from './binding-probe.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { holding } from './written.ts'
import type { App, Directory } from './directory.ts'
import { addressed, sha256 } from './versions.ts'

let memory = () => {
  let held = new Map<string, Uint8Array<ArrayBuffer>>()
  let keys = (prefix: string) =>
    [...held.keys()].filter((key) => key.startsWith(prefix)).sort()
  let files: Objects = {
    has: (key) => Promise.resolve(held.has(key)),
    put: (key, bytes) => {
      held.set(key, new Uint8Array(bytes))
      return Promise.resolve()
    },
    read: (key) => Promise.resolve(held.get(key) ?? null),
    load: async (key) => {
      let bytes = held.get(key)
      return bytes ? { bytes, version: await sha256(bytes) } : null
    },
    open: async (key) => {
      let bytes = held.get(key)
      return bytes
        ? {
          size: bytes.byteLength,
          version: await sha256(bytes),
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
    get: (key) => {
      let bytes = held.get(key)
      if (!bytes) throw new Error(`no object at ${key}`)
      return Promise.resolve(bytes)
    },
    delete: (keys) => {
      for (let key of [keys].flat()) held.delete(key)
      return Promise.resolve()
    },
    list: (prefix) => Promise.resolve(keys(prefix)),
    uploaded: (prefix) =>
      Promise.resolve(
        Object.fromEntries(keys(prefix).map((key) => [key, Date.now()])),
      ),
  }
  return { files, held }
}

let bytes = (text: string) => new TextEncoder().encode(text)
let text = (bytes: Uint8Array<ArrayBuffer> | null) =>
  bytes ? new TextDecoder().decode(bytes) : null

// Two files already stored, by their content address.
let page = bytes('new page'), kept = bytes('kept code')
let [PAGE, KEPT] = await Promise.all([page, kept].map(sha256))

test('a release names the shas it is made of, and copies none', async () => {
  let { files, held } = memory()
  await files.put(addressed(PAGE), page)
  await files.put(addressed(KEPT), kept)
  let next = 'alice/.releases/app/next'
  let stage = staged(files, {
    'index.html': PAGE,
    'keep.js': KEPT,
    'esbuild/stale.js': KEPT,
  }, next)
  // What a compile reads, it reads through the release, and what it writes
  // and drops changes only the release.
  assertEquals(text(await stage.files.read(`${next}/keep.js`)), 'kept code')
  await stage.files.put(`${next}/esbuild/keep.js`, bytes('compiled'))
  await stage.files.delete(`${next}/esbuild/stale.js`)
  assertEquals(await stage.finish(), {
    'index.html': PAGE,
    'keep.js': KEPT,
  })
  assertEquals([...held.keys()].filter((key) => key.startsWith(`${next}/`)), [])
  let served = releaseFiles(files)
  assertEquals(text(await served.read(`${next}/index.html`)), 'new page')
  assertEquals(text(await served.read(`${next}/keep.js`)), 'kept code')
  assertEquals(text(await served.read(`${next}/esbuild/keep.js`)), 'compiled')
  assertEquals(await served.read(`${next}/esbuild/stale.js`), null)
  assertEquals(
    await served.list(`${next}/`),
    [`${next}/esbuild/keep.js`, `${next}/index.html`, `${next}/keep.js`],
  )
})

// An erasure counts an app's files, then sweeps its release. One that died
// partway (an interrupted sweep, retried as a durable effect) finds the
// release gone and must still finish, so its count reads a swept release as
// holding nothing, where serving it is still refused (T-131465).
test('an erasure asked again counts a release it already swept as empty', async () => {
  let { files } = memory()
  let source = 'alice/.releases/app/live'
  await staged(files, { 'index.html': PAGE }, source).finish()
  let app = { source, draft: null } as unknown as App
  let dir = {} as Directory
  assertEquals(await holding(files, dir, app), ['index.html'])
  let swept = memory().files
  assertEquals(await holding(swept, dir, app), [])
  await assertRejects(() => filesAt(swept, source), Error, 'has no index')
})

// An idle app's first view comes to an isolate holding no index of its
// release. A page is one trip to the bucket, its text in the index, where it
// was the index and then the page (T-143062), and so is a page served from the
// folder the app's wrangler config names. Any other file is the index and
// then its bytes, as is a page that is not UTF-8, served as it was stored.
type Body = string | Uint8Array
let made = 0
let first = async (written: Record<string, Body>, path: string) => {
  let b = bucket()
  // Each its own release, as every deploy's is: what a release's config says
  // is kept by its name (files.ts `configOf`).
  let source = `ada/.releases/app/${made++}`
  // The deploy's isolate, holding the index it wrote; the view's holds none.
  let deploy = { ...b.r2 } as unknown as Env['BLOBS']
  let stage = staged(r2RawObjects(deploy), {}, source)
  for (let [at, body] of Object.entries(written)) {
    let put = typeof body == 'string' ? bytes(body) : body
    await stage.files.put(`${source}/${at}`, put)
  }
  await stage.finish()
  let env = { BLOBS: b.r2 } as unknown as Env
  let r = await fileBytes(env, 'eid', source, path, source)
  let timing = r.headers.get('server-timing') ?? ''
  return [
    r.status,
    [...new Uint8Array(await r.arrayBuffer())],
    Number(/(?:^|, *)file_r2;dur=(\d+)/.exec(timing)?.[1]),
  ]
}
let site = {
  'index.html': 'home',
  'about.html': 'about',
  '404.html': 'lost',
  'style.css': 'body {}',
}
let built = {
  'wrangler.jsonc': '{"assets":{"directory":"dist"}}',
  'dist/index.html': 'built home',
}
let raw = new Uint8Array([0x3c, 0xff, 0x3e])
let views: [string, Record<string, Body>, string, number, Body, number][] = [
  ['the front page', site, '/', 200, 'home', 1],
  ['a page by its address', site, '/about', 200, 'about', 1],
  ["the app's 404", site, '/nowhere', 404, 'lost', 1],
  ['a stylesheet', site, '/style.css', 200, 'body {}', 2],
  ['a built folder', built, '/', 200, 'built home', 1],
  ['bytes that are not UTF-8', { 'index.html': raw }, '/', 200, raw, 2],
]
for (let [what, files, path, status, body, trips] of views) {
  test(`a cold first view of ${what} asks the bucket ${trips}×`, async () => {
    let expected = typeof body == 'string' ? bytes(body) : body
    assertEquals(await first(files, path), [status, [...expected], trips])
  })
}
