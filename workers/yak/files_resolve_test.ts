// Which file answers a path with no file behind it, in each of
// `assets.not_found_handling`'s modes (files.ts `resolve`).
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { resolve } from './files.ts'
import { type NotFound, parse } from './wrangler_app.ts'

let held = (paths: string[]) => (p: string) =>
  Promise.resolve(
    paths.includes(p) ? { bytes: new Uint8Array(), version: '' } : null,
  )

let all = ['/index.html', '/404.html', '/docs/404.html']
let at = async (mode: NotFound | undefined, path: string, files = all) => {
  let got = await resolve(path, held(files), mode)
  return got && 'path' in got ? [got.path, got.status] : got
}

test('unset keeps the root 404.html, then index.html for a route', async () => {
  assertEquals(await at(undefined, '/x/y'), ['404.html', 404])
  assertEquals(await at(undefined, '/x/y', ['/index.html']), [
    'index.html',
    200,
  ])
})

test('single-page-application answers a route index.html with 200', async () => {
  assertEquals(await at('single-page-application', '/x/y'), [
    'index.html',
    200,
  ])
})

test('404-page answers the nearest 404.html, else a plain 404', async () => {
  assertEquals(await at('404-page', '/docs/x'), ['docs/404.html', 404])
  assertEquals(await at('404-page', '/x'), ['404.html', 404])
  assertEquals(await at('404-page', '/x', ['/index.html']), null)
})

test('none is a plain 404', async () => {
  assertEquals(await at('none', '/x'), null)
})

test('a missing asset is a 404 in every mode', async () => {
  let modes = [
    undefined,
    'single-page-application',
    '404-page',
    'none',
  ] as const
  for (let m of modes) assertEquals(await at(m, '/app.css'), null)
})

test('the key is read from wrangler.jsonc and refuses other values', () => {
  let ok = parse(
    '{"assets":{"directory":"dist","not_found_handling":"404-page"}}',
  )
  assertEquals(ok.config.assets, {
    directory: 'dist',
    not_found_handling: '404-page',
  })
  assertEquals(
    parse('{"assets":{"not_found_handling":"nope"}}').refused.length > 0,
    true,
  )
})
