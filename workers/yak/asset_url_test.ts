// A page's static references move as a release, while its app calls and links
// stay where the page put them.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  apiOut,
  assetMaps,
  assetPath,
  assetUrl,
  failedScript,
  releaseId,
} from './asset_url.ts'

test('script failures belong to the reported release and its own file paths', () => {
  let id = '3c92f71b-848e-4492-95e7-c73402b90ffc'
  let release = {
    version: 2,
    source: `ada/.releases/app/${id}`,
    files: { 'main.js': 'sha' },
  }
  let request = 'https://ada.yaks.app/cookbook/api/report'
  let check = (src: string, version: number | null = 2, mount = '/cookbook/') =>
    failedScript(
      { version, message: `failed to load script ${src}` },
      release,
      request,
      mount,
    )
  assertEquals(check('https://ada.yaks.app/cookbook/main.js'), 'main.js')
  assertEquals(check(`/cookbook/api/assets/${id}/main.js?v=1`), 'main.js')
  assertEquals(check(`/api/assets/${id}/main.js`, 2, '/'), 'main.js')
  assertEquals(
    check(
      `/cookbook/~ticket/api/assets/${id}/main.js`,
      2,
      '/cookbook/~ticket/',
    ),
    'main.js',
  )
  for (
    let src of [
      'https://elsewhere.test/cookbook/main.js',
      '/another/main.js',
      '/cookbook/api/client.js',
      '/cookbook/missing.js',
      '/cookbook/api/assets/00000000-0000-4000-8000-000000000000/main.js',
      '/cookbook/%ZZ.js',
    ]
  ) assertEquals(check(src), null)
  assertEquals(check('/cookbook/main.js', 1), null)
  assertEquals(check('/cookbook/main.js', null), null)
  assertEquals(
    failedScript(
      { version: 2, message: 'x is not a function' },
      release,
      request,
      '/cookbook/',
    ),
    null,
  )
})

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
  // A page in a folder resolves from that folder, and its release path is
  // the file's own from the app's address.
  let about = (ref: string) =>
    assetUrl(ref, at, at, id, () => false, `${at}about/`)
  assertEquals(about('../styles/main.css'), file)
  assertEquals(about('./me.png'), `${at}api/assets/${id}/about/me.png`)
  assertEquals(about('../../elsewhere.js'), '../../elsewhere.js')
})

test("a script failure in a served folder is that folder's file", () => {
  let release = { version: 2, files: { 'dist/assets/app.js': 'sha' } }
  assertEquals(
    failedScript(
      { version: 2, message: 'failed to load script /vite/assets/app.js' },
      release,
      'https://ada.yaks.app/vite/api/report',
      '/vite/',
      'dist',
    ),
    'dist/assets/app.js',
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

// The browser resolves a module's imports against the module's own address,
// so the client a release's module imports sits below the release; it climbs
// back out through whatever mount the browser asked by.
test("a release asset's API reference climbs out through its mount", () => {
  let id = '3c92f71b-848e-4492-95e7-c73402b90ffc'
  let out = (mount: string, ref: string) => {
    let module = `https://ada.yaks.app${mount}api/assets/${id}/lib/main.js`
    let asked = new URL(ref, module)
    let asset = assetPath(asked.pathname.slice(`${mount}api`.length))!
    return new URL(apiOut(asset.path)!, asked).pathname
  }
  assertEquals(out('/cookbook/', '../api/client.js'), '/cookbook/api/client.js')
  assertEquals(out('/', '../api/blob/x/y'), '/api/blob/x/y')
  assertEquals(
    out('/cookbook/~ticket/', '../api/client.js'),
    '/cookbook/~ticket/api/client.js',
  )
  assertEquals(apiOut('/lib/main.js'), null)
})
