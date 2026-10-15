// A release names the shas its files are, and still serves a whole app once
// the keys it was made from are gone.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Objects } from '@yaks/blob'
import { prepare, promoted, releaseFiles, staged } from './release.ts'
import { encode } from './release_index.ts'
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

let sha = sha256

test('a release names the shas it is made of, and copies none', async () => {
  let { files, held } = memory()
  let page = bytes('new page'), kept = bytes('kept code')
  for (let b of [page, kept]) await files.put(addressed(await sha(b)), b)
  let next = 'alice/.releases/app/next'
  let stage = staged(files, {
    'index.html': await sha(page),
    'keep.js': await sha(kept),
    'esbuild/stale.js': await sha(kept),
  }, next)
  // What a compile reads, it reads through the release, and what it writes
  // and drops changes only the release.
  assertEquals(text(await stage.files.read(`${next}/keep.js`)), 'kept code')
  await stage.files.put(`${next}/esbuild/keep.js`, bytes('compiled'))
  await stage.files.delete(`${next}/esbuild/stale.js`)
  assertEquals(await stage.finish(), {
    'index.html': await sha(page),
    'keep.js': await sha(kept),
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

test('a live indexed release keeps its bytes when promoted', async () => {
  let { files } = memory()
  let source = 'alice/.releases/app/live'
  await files.put(`${source}/index.html`, bytes('page'))
  await files.put(`${source}/esbuild/main.js`, bytes('compiled'))
  await files.put(
    source + '.json',
    encode({
      'index.html': {
        key: '.releases/app/live/index.html',
        sha: await sha256(bytes('page')),
      },
      'esbuild/main.js': { key: '.releases/app/live/esbuild/main.js' },
    }),
  )
  let before = await releaseFiles(files).read(`${source}/esbuild/main.js`)
  let index = await prepare(files, source)
  assertEquals(index['esbuild/main.js'].sha, await sha256(bytes('compiled')))
  await files.delete(`${source}/index.html`)
  await files.delete(`${source}/esbuild/main.js`)
  assertEquals(
    text(await releaseFiles(files).read(`${source}/esbuild/main.js`)),
    text(before),
  )
  assertEquals(
    text(await releaseFiles(files).read(`${source}/index.html`)),
    'page',
  )
  assertEquals(await prepare(files, source), index)
})

test('an app served in place is promoted to a release once', async () => {
  let { files, held } = memory()
  let stamped: unknown[] = []
  let dir = {
    stamp: (m: { entities: unknown[] }) =>
      Promise.resolve(void stamped.push(...m.entities)),
  } as unknown as Directory
  let app = { eid: 'e1', slug: 'garden', version: 7 } as App
  let prefix = 'yourname/garden/'
  await files.put(`${prefix}index.html`, bytes('page'))
  await files.put(`${prefix}esbuild/app.js`, bytes('compiled'))
  await files.put(`${prefix}history/index.html.json`, bytes('[]'))
  await files.put(`${prefix}blobs/${'0'.repeat(64)}`, bytes('upload'))
  await files.put('yourname/.declarations/e1/legacy/7.json', bytes('{}'))
  let { source } = await promoted(files, dir, prefix, app)
  assertEquals(source!.startsWith('yourname/.releases/e1/'), true)
  let release = source!.split('/').pop()
  assertEquals(
    text(await files.read(`yourname/.declarations/e1/${release}/7.json`)),
    '{}',
  )
  let served = releaseFiles(files)
  assertEquals(text(await served.read(`${source}/index.html`)), 'page')
  assertEquals(text(await served.read(`${source}/esbuild/app.js`)), 'compiled')
  assertEquals(await served.list(`${source}/`), [
    `${source}/esbuild/app.js`,
    `${source}/index.html`,
  ])
  assertEquals(held.has(addressed(await sha256(bytes('page')))), true)
  // An app with a source, or with nothing in place, is left alone.
  assertEquals(await promoted(files, dir, prefix, { ...app, source }), {
    ...app,
    source,
  })
  assertEquals(await promoted(files, dir, 'yourname/empty/', app), app)
  assertEquals(stamped.length, 1)
  // A draft it had open stays open over the release.
  let draft = 'yourname/.drafts/e1/delta-v8-x'
  assertEquals(
    (await promoted(files, dir, prefix, { ...app, draft })).draft,
    draft,
  )
  assertEquals(stamped.length, 2)
})
