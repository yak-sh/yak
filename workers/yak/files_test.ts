// A release's files asked for at its deploy are what its first view finds in
// the cache (files.ts `warm`, T-124006). FILES here is a cache keyed by
// address, as Workers Caching is, in front of the same inner door.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { fetch, fileBytes, warm } from './files.ts'
import { platform } from './serving-probe.ts'

let { env, files } = platform()
let eid = '11111111-1111-4111-8111-111111111111'
let source = 'ada/notes'
let text = (s: string) => new TextEncoder().encode(s)
for (
  let [path, body] of Object.entries({
    'index.html': '<h1>notes</h1>',
    'style.css': 'h1{}',
    'a b.css': 'p{}',
    'sub/index.html': '<h1>sub</h1>',
    'worker.js': 'export default {}',
    'vocab.json': '{}',
  })
) files.held.set(`${source}/${path}`, text(body))

let cached = new Map<string, Uint8Array>()
let missed: string[] = []
env.FILES = {
  fetch: async (req) => {
    let held = cached.get(req.url)
    if (held) return new Response(held.slice())
    missed.push(new URL(req.url).pathname)
    let res = await fetch(req, env)
    let bytes = new Uint8Array(await res.arrayBuffer())
    if (res.ok) cached.set(req.url, bytes)
    return new Response(bytes, res)
  },
}

test('a warmed release answers its first views from the cache', async () => {
  await warm(env, eid, source, [
    'index.html',
    'style.css',
    'a b.css',
    'sub/index.html',
    'worker.js',
    'vocab.json',
  ])
  let warmed = missed.splice(0)
  // The addresses a browser opens, and never the app's inside.
  assertEquals(warmed.sort(), [
    `/${eid}/`,
    `/${eid}/a%20b.css`,
    `/${eid}/style.css`,
    `/${eid}/sub/`,
  ])
  for (
    let [path, body] of [
      ['/', '<h1>notes</h1>'],
      ['/style.css', 'h1{}'],
      ['/a%20b.css', 'p{}'],
      ['/sub/', '<h1>sub</h1>'],
    ]
  ) {
    let got = await fileBytes(env, eid, source, path, source)
    assertEquals(await got.text(), body)
  }
  assertEquals(missed, [])
})
