// A private release reuses immutable source bytes and still serves a complete
// app after its draft and the old release's unreferenced files are removed.
import { assertEquals } from '@std/assert'
import type { Objects } from '@yaks/blob'
import { prepare, releaseFiles, staged } from './release.ts'
import { encode, indexOf } from './release_index.ts'
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
    delete: (key) => {
      held.delete(key)
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

Deno.test('a release serves unchanged, changed, and compiled files', async () => {
  let { files, held } = memory()
  let old = 'alice/.releases/app/old'
  let next = 'alice/.releases/app/next'
  let draft = 'alice/.drafts/app/delta-v2'
  await files.put(`${old}/index.html`, bytes('old page'))
  await files.put(`${old}/keep.js`, bytes('kept code'))
  await files.put(`${old}/remove.css`, bytes('old style'))
  await files.put(`${draft}/index.html`, bytes('new page'))
  await files.put(`${draft}/.deleted/remove.css`, bytes(''))
  let prior = Object.fromEntries(
    await Promise.all(
      ['index.html', 'keep.js', 'remove.css'].map(async (path) =>
        [path, await sha256(await files.get(`${old}/${path}`))] as const
      ),
    ),
  )
  let stage = await staged(
    files,
    old,
    draft,
    next,
    true,
  )
  await stage.files.put(`${next}/esbuild/keep.js`, bytes('compiled'))
  let snapshot = await stage.finish()
  assertEquals(snapshot, {
    'index.html': await sha256(bytes('new page')),
    'keep.js': prior['keep.js'],
  })
  assertEquals(held.has(`${next}/keep.js`), false)
  assertEquals(held.has(`${next}/index.html`), false)
  assertEquals(await files.has(addressed(snapshot['index.html'])), true)
  let index = await indexOf(files, `${next}/`)
  let compiled = index!['esbuild/keep.js']
  assertEquals(compiled.sha, await sha256(bytes('compiled')))
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

Deno.test('a live indexed release keeps its bytes when promoted', async () => {
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

Deno.test('copying a legacy release leaves its source index untouched', async () => {
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
