import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { bucketObjects, rangedOpen } from '@yaks/blob'
import { bucket } from './binding-probe.ts'
import { keepShared, openShared } from './shared-files.ts'
import { writeResources } from './esbuild.ts'
import { fetch } from './shared.ts'
import { r2RawObjects } from './lib/objects.ts'
import type { Env } from './env.ts'

let root = `__packages/${'a'.repeat(64)}/`
let files = Object.fromEntries(
  Array.from(
    { length: 395 },
    (_, i) => [root + `chunk-${i}.js`, `export let n = ${i}`],
  ),
)
let b = bucket()
let raw = bucketObjects(b.r2)
let writes: string[] = []
let blobs = {
  ...raw,
  put: async (key: string, bytes: Uint8Array<ArrayBuffer>) => {
    writes.push(key)
    await raw.put(key, bytes)
  },
}
await writeResources(blobs, 'app/', [], [], {
  pages: {},
  assets: {},
  shared: files,
})
let firstWrites = [...writes]
await writeResources(blobs, 'another/', [], [], {
  pages: {},
  assets: {},
  shared: files,
})

test('deploying hundreds of shared chunks writes one complete group, reused by other apps', async () => {
  equal(firstWrites.length, 1)
  equal(writes, firstWrites)
  let fresh = bucketObjects(b.r2)
  for (let i of [0, 197, 394]) {
    let opened = (await openShared(fresh, root + `chunk-${i}.js`))!
    equal(
      await new Response(await opened.read()).text(),
      files[root + `chunk-${i}.js`],
    )
  }
  equal(await openShared(fresh, root + 'absent.js'), null)
  // All three files came from a single read of the group in a fresh isolate.
  equal(b.gets.length, 1)
})

test('a failed group write leaves no completion and the next deploy retries', async () => {
  let failing = bucketObjects(bucket().r2)
  let attempts = 0
  let writer = {
    ...failing,
    put: (key: string, bytes: Uint8Array<ArrayBuffer>) =>
      ++attempts == 1
        ? Promise.reject(new Error('storage failed'))
        : failing.put(key, bytes),
  }
  await assertRejects(() => keepShared(writer, files), Error, 'storage failed')
  await keepShared(writer, files)
  equal(attempts, 2)
  equal(!!await openShared(failing, root + 'chunk-0.js'), true)
})

let env = { BLOBS: b.r2 } as unknown as Env
let asked = (path: string, init?: RequestInit) =>
  fetch(new Request(`https://yaks.app/${root}${path}`, init), env)

test('packed modules keep their public URLs, MIME, ranges, HEAD and validators', async () => {
  let whole = await asked('chunk-0.js')
  equal(await whole.text(), 'export let n = 0')
  equal(whole.headers.get('content-type'), 'text/javascript; charset=utf-8')
  let head = await asked('chunk-0.js', { method: 'HEAD' })
  equal(head.headers.get('content-length'), '16')
  equal(await head.text(), '')
  let part = await asked('chunk-0.js', { headers: { range: 'bytes=0-5' } })
  equal(part.status, 206)
  equal(await part.text(), 'export')
  equal(
    (await asked('chunk-0.js', {
      headers: { 'if-none-match': whole.headers.get('etag')! },
    })).status,
    304,
  )
  equal((await asked('absent.js')).status, 404)
})

test('old releases still serve individually stored modules', async () => {
  let legacy = `__packages/${'b'.repeat(64)}/old.js`
  await r2RawObjects(b.r2).put(legacy, new TextEncoder().encode('old'))
  let response = await fetch(new Request(`https://yaks.app/${legacy}`), env)
  equal(await response.text(), 'old')
})

test('a reader that missed a group before its deploy reads it after the write', async () => {
  let raw = bucketObjects(bucket().r2)
  equal(await openShared(raw, root + 'chunk-0.js'), null)
  await keepShared(raw, files)
  let opened = (await openShared(raw, root + 'chunk-0.js'))!
  equal(
    await (await rangedOpen(opened, new Request('https://files/'))).text(),
    'export let n = 0',
  )
})
