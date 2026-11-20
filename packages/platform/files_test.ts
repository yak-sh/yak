// Which file answers a path with no file behind it, in each of
// `assets.not_found_handling`'s modes (./files.ts `resolve`).
import { equal, test } from '@yaks/testing'
import { type NotFound, resolve } from './files.ts'

let held = (paths: string[]) => (p: string) =>
  Promise.resolve(
    paths.includes(p) ? { bytes: new Uint8Array(), version: '' } : null,
  )

let all = ['/index.html', '/404.html', '/docs/404.html']
let at = async (mode: NotFound | undefined, path: string, files = all) => {
  let got = await resolve(path, held(files), mode)
  return got && 'path' in got ? [got.path, got.status] : got
}

test('unset answers the root 404.html, else a plain 404', async () => {
  equal(await at(undefined, '/x/y'), ['404.html', 404])
  equal(await at(undefined, '/x/y/', ['/index.html']), null)
})

test('single-page-application answers a route index.html with 200', async () => {
  equal(await at('single-page-application', '/x/y'), ['index.html', 200])
  equal(await at('single-page-application', '/u/1/f/1/', ['/index.html']), [
    'index.html',
    200,
  ])
})

test('single-page-application answers a route that repeats itself 404', async () => {
  equal(await at('single-page-application', '/a/b/c/a/b'), ['404.html', 404])
  equal(await at('single-page-application', '/a/a/', ['/index.html']), null)
})

test('404-page answers the nearest 404.html, else a plain 404', async () => {
  equal(await at('404-page', '/docs/x'), ['docs/404.html', 404])
  equal(await at('404-page', '/x'), ['404.html', 404])
  equal(await at('404-page', '/x', ['/index.html']), null)
})

test('none is a plain 404', async () => {
  equal(await at('none', '/x'), null)
})

test('a missing asset is a 404 in every mode', async () => {
  let modes = [
    undefined,
    'single-page-application',
    '404-page',
    'none',
  ] as const
  for (let m of modes) equal(await at(m, '/app.css'), null)
})

test('a folder asked for without its slash is sent to it', async () => {
  equal(await resolve('/docs', held(['/docs/index.html'])), { to: 'docs/' })
})
