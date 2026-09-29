// A page's static references move as a release, while its app calls and links
// stay where the page put them.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { assetMaps, assetPath, assetUrl, releaseId } from './asset_url.ts'

test('release URLs keep local assets under their mount', () => {
  let id = '3c92f71b-848e-4492-95e7-c73402b90ffc'
  assertEquals(releaseId(`ada/.releases/app/${id}`), id)
  assertEquals(releaseId('ada/cookbook'), null)
  let at = '/cookbook/'
  let file = `${at}api/assets/${id}/styles/main.css`
  assertEquals(assetUrl('./styles/main.css', at, at, id), file)
  assertEquals(assetUrl('/cookbook/styles/main.css', at, at, id), file)
  assertEquals(
    assetUrl('./styles/main.css?v=2#top', at, at, id),
    `${file}?v=2#top`,
  )
  assertEquals(assetPath(`/assets/${id}/styles/main.css`), {
    release: id,
    path: '/styles/main.css',
  })
  assertEquals(assetUrl('./next.html', at, at, id), './next.html')
  assertEquals(assetUrl('./api/query?q=x', at, at, id), './api/query?q=x')
  assertEquals(
    assetUrl('https://cdn.example/x.js', at, at, id),
    'https://cdn.example/x.js',
  )
  assertEquals(
    assetUrl('data:image/png;base64,a', at, at, id),
    'data:image/png;base64,a',
  )
  assertEquals(
    assetUrl('/build.js', '/', '/', id, (p) => p == '/build.js'),
    '/build.js',
  )
  assertEquals(
    assetUrl('./main.js', '/cookbook/~ticket/', '/cookbook/', id),
    `/cookbook/~ticket/api/assets/${id}/main.js`,
  )
})

test('local import-map values, URL keys, and scopes follow a release', () => {
  let id = '3c92f71b-848e-4492-95e7-c73402b90ffc'
  let html = `<script type=importmap>{"imports":{` +
    `"@local":"./scripts/chunk.js",` +
    `"./scripts/direct.js":"./scripts/chunk.js",` +
    `"@remote":"https://cdn.example/lib.js",` +
    `"pkg/":"./scripts/","root/":"./"},` +
    `"scopes":{"./scripts/":{"@scope":"./shared.js"}}` +
    `}</script>`
  let served = assetMaps(html, '/cookbook/', '/cookbook/', id)
  let map = JSON.parse(served.match(/<script[^>]*>(.*?)<\/script>/)![1])
  let root = `/cookbook/api/assets/${id}/`
  assertEquals(map.imports['@local'], `${root}scripts/chunk.js`)
  assertEquals(
    map.imports[`${root}scripts/direct.js`],
    `${root}scripts/chunk.js`,
  )
  assertEquals(map.imports['@remote'], 'https://cdn.example/lib.js')
  assertEquals(map.imports['pkg/'], `${root}scripts/`)
  assertEquals(map.imports['root/'], root)
  assertEquals(map.scopes[`${root}scripts/`]['@scope'], `${root}shared.js`)
  assertEquals(
    assetMaps(
      '<script type=importmap>{bad}</script>',
      '/cookbook/',
      '/cookbook/',
      id,
    ),
    '<script type=importmap>{bad}</script>',
  )
})
