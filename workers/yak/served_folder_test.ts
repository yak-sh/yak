// An app whose wrangler config serves a folder (T-124473, T-124474): its
// tools say which files answer on the web, and which are source only, through
// files.ts `whereIn`, `sourceOnly` and `servesSaid`.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { servesSaid, sourceOnly, whereIn } from './files.ts'

let dist = { assets: { directory: 'dist' } }
let at = 'https://ada.yaks.app/site/'

test('app_files gives addresses only for files the app serves', () => {
  let where = whereIn(at, dist)
  assertEquals(where.dir, 'dist')
  assertEquals(where('dist/about/index.html'), `${at}about/`)
  assertStringIncludes(where('src/main.js'), 'source only, not on the web')
  assertEquals(whereIn(at, {})('src/main.js'), `${at}src/main.js`)
  assertEquals(
    sourceOnly(dist, ['dist/index.html', 'src/main.js', 'wrangler.jsonc']),
    { dir: 'dist', source: ['src/main.js', 'wrangler.jsonc'] },
  )
  assertEquals(sourceOnly({}, ['src/main.js']).source, [])
})

test('app_deploy says which folder the app serves', () => {
  assertStringIncludes(servesSaid('dist'), 'serves dist/')
  assertEquals(servesSaid(undefined), '')
})
