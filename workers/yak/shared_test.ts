import { equal, test } from '@yaks/testing'
import { bucket } from './binding-probe.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'
import { keepShared } from './shared-files.ts'
import { fetch } from './shared.ts'

let types = {
  'x.html': 'application/octet-stream',
  'x.HTM': 'application/octet-stream',
  'x.xhtml': 'application/octet-stream',
  'x.xml': 'application/octet-stream',
  'package.json': 'application/octet-stream',
  'x.txt': 'application/octet-stream',
  'x.pdf': 'application/octet-stream',
  LICENSE: 'application/octet-stream',
  'x.js': 'text/javascript; charset=utf-8',
  'x.mjs': 'text/javascript; charset=utf-8',
  'x.cjs': 'text/javascript; charset=utf-8',
  'x.css': 'text/css; charset=utf-8',
  'x.woff': 'font/woff',
  'x.woff2': 'font/woff2',
  'x.ttf': 'font/ttf',
  'x.otf': 'font/otf',
  'x.wasm': 'application/wasm',
  'x.svg': 'image/svg+xml',
  'x.png': 'image/png',
  'x.webp': 'image/webp',
}
let body = '<script>parent.postMessage(document.cookie, "*")</script>'
let b = bucket()
let raw = r2RawObjects(b.r2)
let env = { BLOBS: b.r2 } as unknown as Env
let asked = (root: string, path: string, init?: RequestInit) =>
  fetch(new Request(`https://yaks.app/${root}${path}`, init), env)

for (let [storage, hash] of [['individual', 'c'], ['packed', 'd']]) {
  let root = `__packages/${hash.repeat(64)}/`
  let files = Object.fromEntries(
    Object.keys(types).map((p) => [root + p, body]),
  )
  if (storage == 'packed') await keepShared(raw, files)
  else {
    await Promise.all(
      Object.entries(files).map(([p, text]) =>
        raw.put(p, new TextEncoder().encode(text))
      ),
    )
  }

  for (let [path, type] of Object.entries(types)) {
    test(`${storage} package ${path} keeps its resource type or downloads, sandboxed`, async () => {
      let response = await asked(root, path)
      equal(response.status, 200)
      equal(response.headers.get('content-type'), type)
      equal(response.headers.get('content-security-policy'), 'sandbox')
      equal(response.headers.get('x-content-type-options'), 'nosniff')
      equal(response.headers.get('access-control-allow-origin'), '*')
      equal(await response.text(), body)
    })
  }

  for (
    let [path, type] of [
      ['x.html', 'application/octet-stream'],
      ['x.svg', 'image/svg+xml'],
    ]
  ) {
    let whole = await asked(root, path)
    await whole.body?.cancel()
    for (
      let [init, status] of [
        [{ method: 'HEAD' }, 200],
        [{ headers: { range: 'bytes=0-6' } }, 206],
        [{ headers: { 'if-none-match': whole.headers.get('etag')! } }, 304],
        [{ headers: { range: 'bytes=10000-' } }, 416],
      ] as [RequestInit, number][]
    ) {
      test(`${storage} package ${path} keeps protection on ${JSON.stringify(init)}`, async () => {
        let response = await asked(root, path, init)
        equal(response.status, status)
        equal(response.headers.get('content-type'), type)
        equal(response.headers.get('content-security-policy'), 'sandbox')
        equal(response.headers.get('x-content-type-options'), 'nosniff')
        await response.body?.cancel()
      })
    }
  }
}
