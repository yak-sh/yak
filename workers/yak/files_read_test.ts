// Reading an app back in one call (T-124200): the budget at its seam, then
// the tool through the connector, over a release and over a draft.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { peruse } from './files_read.ts'
import { digest } from '@yaks/graph/sha256'
import { connector, kernel, seed, unique } from './probe.ts'
import type { Bundle } from '@yaks/graph'

let encode = (s: string) => new TextEncoder().encode(s)
let WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
// A 1×1 lossless WebP.
let WEBP = Uint8Array.from(
  atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='),
  (c) => c.charCodeAt(0),
)
let b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

// An `open` over files in memory, the way a bucket answers one.
type Held = Record<string, string | Uint8Array<ArrayBuffer>>
let opener = (files: Held) => (path: string) => {
  let f = files[path]
  if (f == null) return Promise.resolve(null)
  let bytes = typeof f == 'string' ? encode(f) : f
  return Promise.resolve({
    size: bytes.byteLength,
    version: '',
    read: () => Promise.resolve(new Response(bytes).body!),
  })
}

let read = async (files: Held, paths: string[], budget?: number) => {
  let { files: got, unread } = await peruse(paths, opener(files), budget)
  return { read: got.map((f) => f.path), unread }
}

test('a read passes over what the budget cannot hold and reads on', async () => {
  let files = { a: 'aaaaaa', b: 'bbbbbb', c: 'ccc' }
  assertEquals(await read(files, ['a', 'b', 'c'], 10), {
    read: ['a', 'c'],
    unread: [{ path: 'b', why: 'budget', size: 6 }],
  })
})

test('a read names a missing path and bytes that are not text', async () => {
  assertEquals(
    await read({ 'a.js': 'let a', 'i.wasm': WASM }, [
      'i.wasm',
      'a.js',
      'x',
      'a.js',
    ]),
    {
      read: ['a.js'],
      unread: [
        { path: 'i.wasm', why: 'binary', size: WASM.byteLength },
        { path: 'x', why: 'missing' },
      ],
    },
  )
})

// The tool, through the connector: written, deployed, then read back over
// the release and over a draft that edits one file and deletes another.
let k = await kernel()
let space = unique('read-back')
let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
let agent = connector(k, cookie)
let app = { space, app: 'site' }
let files = {
  'index.html': '<h1>Hi</h1><script src="app.js"></script>',
  'app.js': 'console.log("hi")\n',
  'NOTES.md': 'Notes\n\n```js\nlet fenced = true\n```\n',
}
await agent.tool('app_files', {
  ...app,
  files: [
    ...Object.entries(files).map(([path, content]) => ({ path, content })),
    { path: 'add.wasm', base64: b64(WASM) },
    { path: 'art.webp', base64: b64(WEBP) },
  ],
})
await agent.tool('app_deploy', app)
let back = (more: Record<string, unknown> = {}) =>
  agent.answer('app_files', { ...app, op: 'read', ...more })
let all = await back()
await agent.tool('app_files', { ...app, path: 'app.js', content: 'v2' })
await agent.tool('app_files', { ...app, op: 'delete', path: 'NOTES.md' })
let draft = await back()
let some = await back({ paths: ['index.html', 'nope.js'] })
let one = await back({ path: 'app.js' })

let listed = (named: Record<string, string>) =>
  Promise.all(
    Object.keys(named).sort().map(async (path) => ({
      path,
      sha: await digest(encode(named[path])),
      size: encode(named[path]).byteLength,
    })),
  )

test('op read with no path answers every text file of the app', async () => {
  assertEquals(all.value?.files, await listed(files))
  assertEquals(all.value?.unread, [
    { path: 'add.wasm', why: 'binary', size: WASM.byteLength },
    { path: 'art.webp', why: 'binary', size: WEBP.byteLength },
  ])
  assertEquals(all.value?.version, 1)
  // claude.ai's model reads only the words, so they carry it all too.
  for (let [path, content] of Object.entries(files)) {
    assertStringIncludes(all.text, path)
    assertStringIncludes(all.text, content)
    assertStringIncludes(all.text, await digest(encode(content)))
  }
})

test('op read answers the draft, edits and deletes included', async () => {
  assertEquals(
    draft.value?.files,
    await listed({ 'app.js': 'v2', 'index.html': files['index.html'] }),
  )
})

test('op read with paths answers those, naming what is missing', async () => {
  assertEquals(
    some.value?.files,
    await listed({ 'index.html': files['index.html'] }),
  )
  assertEquals(some.value?.unread, [{ path: 'nope.js', why: 'missing' }])
})

test('op read with one path is that file whole, as its text', () => {
  assertEquals(one.text, 'v2')
})

// A file read whole as what it is: the reply's blocks, its data, its words.
let whole = async (path: string) => {
  let out = await agent.call('tools/call', {
    name: 'app_files',
    arguments: { ...app, op: 'read', path },
  })
  let said = JSON.stringify(out)
  return {
    images: out.content.filter((b: { type: string }) => b.type == 'image'),
    value: out.structuredContent.result.find((b: Bundle) => b.output)?.output
      ?.value,
    said,
  }
}

test('op read of a picture answers the picture, never its bytes as text', async () => {
  let { images, value, said } = await whole('art.webp')
  assertEquals(images, [
    { type: 'image', data: b64(WEBP), mimeType: 'image/webp' },
  ])
  assertEquals(value, {
    version: 1,
    sha: await digest(WEBP),
    size: WEBP.byteLength,
    mediaType: 'image/webp',
  })
  assertEquals(said.includes('WEBPVP8'), false)
})

test('op read of other bytes answers their sha, size and media type', async () => {
  let { images, value, said } = await whole('add.wasm')
  assertEquals(images, [])
  assertEquals(value, {
    version: 1,
    sha: await digest(WASM),
    size: WASM.byteLength,
    mediaType: 'application/wasm',
  })
  assertEquals(said.includes('\\u0000'), false)
})
