// A release names the shas its files are, and still serves a whole app once
// the keys it was made from are gone.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Objects } from '@yaks/blob'
import { filesAt, releaseFiles, staged } from './release.ts'
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
