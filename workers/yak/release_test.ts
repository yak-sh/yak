// A private release reuses immutable source bytes and still serves a complete
// app after its draft and the old release's unreferenced files are removed.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Objects } from '@yaks/blob'
import { prepare, promoted, releaseFiles, staged } from './release.ts'
import { encode, indexOf } from './release_index.ts'
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

let preparedRelease = memory()
let releaseOld = 'alice/.releases/app/old'
let releaseNext = 'alice/.releases/app/next'
let releaseDraft = 'alice/.drafts/app/delta-v2'
let releaseSources = {
  'index.html': bytes('old page'),
  'keep.js': bytes('kept code'),
  'remove.css': bytes('old style'),
}
for (let [path, body] of Object.entries(releaseSources)) {
  await preparedRelease.files.put(`${releaseOld}/${path}`, body)
}
await preparedRelease.files.put(`${releaseDraft}/index.html`, bytes('new page'))
await preparedRelease.files.put(
  `${releaseDraft}/.deleted/remove.css`,
  bytes(''),
)
let keptSha = await sha256(releaseSources['keep.js'])
let newPageSha = await sha256(bytes('new page'))
let compiledSha = await sha256(bytes('compiled'))
let releaseStage = await staged(
  preparedRelease.files,
  releaseOld,
  releaseDraft,
  releaseNext,
  true,
)
await releaseStage.files.put(
  `${releaseNext}/esbuild/keep.js`,
  bytes('compiled'),
)
test('a release serves unchanged, changed, and compiled files', async () => {
  let { files, held } = preparedRelease
  let next = releaseNext, draft = releaseDraft
  let stage = releaseStage
  let snapshot = await stage.finish()
  assertEquals(snapshot, {
    'index.html': newPageSha,
    'keep.js': keptSha,
  })
  assertEquals(held.has(`${next}/keep.js`), false)
  assertEquals(held.has(`${next}/index.html`), false)
  assertEquals(await files.has(addressed(snapshot['index.html'])), true)
  let index = await indexOf(files, `${next}/`)
  let compiled = index!['esbuild/keep.js']
  assertEquals(compiled.sha, compiledSha)
  assertEquals(compiled.key, addressed(compiled.sha!))
  assertEquals(await files.has(compiled.key), true)
  await files.delete(`${draft}/index.html`)
  let served = releaseFiles(files)
  assertEquals(text(await served.read(`${next}/index.html`)), 'new page')
  assertEquals(text(await served.read(`${next}/keep.js`)), 'kept code')
  assertEquals(text(await served.read(`${next}/esbuild/keep.js`)), 'compiled')
  assertEquals(await served.read(`${next}/remove.css`), null)
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

test('copying a legacy release leaves its source index untouched', async () => {
  let { files } = memory()
  let source = 'alice/.releases/app/legacy'
  let copy = 'alice/.releases/app/repacked'
  let old = encode({
    'index.html': { key: '.releases/app/legacy/index.html' },
  })
  await files.put(`${source}/index.html`, bytes('original'))
  await files.put(source + '.json', old)
  let stage = await staged(files, source, 'alice/.drafts/empty', copy, true)
  await stage.files.put(`${copy}/extra.txt`, bytes('changed'))
  await stage.finish()
  assertEquals(text(await files.read(source + '.json')), text(old))
  assertEquals(
    text(await releaseFiles(files).read(`${copy}/index.html`)),
    'original',
  )
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
  assertEquals(await promoted(files, dir, prefix, app), 2)
  let source = (stamped[0] as { app: { source: string } }).app.source
  assertEquals(source.startsWith('yourname/.releases/e1/'), true)
  let release = source.split('/').pop()
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
  assertEquals(await promoted(files, dir, prefix, { ...app, source }), 0)
  assertEquals(await promoted(files, dir, 'yourname/empty/', app), 0)
  assertEquals(stamped.length, 1)
})
