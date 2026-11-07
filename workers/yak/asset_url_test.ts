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

test("a script failure is the release's when it lacks the refused file, the platform's when it holds it", () => {
  let id = '3c92f71b-848e-4492-95e7-c73402b90ffc'
  let release = {
    version: 2,
    source: `ada/.releases/app/${id}`,
    files: { 'main.js': 'sha', 'lib.js': 'sha' },
  }
  let request = 'https://ada.yaks.app/cookbook/api/report'
  let check = (
    src: string,
    file?: string,
    version: number | null = 2,
    mount = '/cookbook/',
  ) =>
    failedScript(
      { version, message: `failed to load script ${src}`, file },
      release,
      request,
      mount,
    )
  let lacks = { script: 'main.js', missing: 'missing.js' }
  let gone = '/cookbook/missing.js'
  assertEquals(check('https://ada.yaks.app/cookbook/main.js', gone), lacks)
  assertEquals(
    check(
      `/cookbook/api/assets/${id}/main.js?v=1`,
      `/cookbook/api/assets/${id}/missing.js`,
    ),
    lacks,
  )
  assertEquals(check(`/api/assets/${id}/main.js`, '/missing.js', 2, '/'), lacks)
  assertEquals(
    check(
      `/cookbook/~ticket/api/assets/${id}/main.js`,
      `/cookbook/~ticket/api/assets/${id}/missing.js`,
      2,
      '/cookbook/~ticket/',
    ),
    lacks,
  )
  // Every file it loads is in the release: the platform refused its own.
  for (let file of [undefined, '/cookbook/main.js', '/cookbook/lib.js']) {
    assertEquals(check('/cookbook/main.js', file), null)
  }
  // Not the release's own files.
  for (
    let src of [
      'https://elsewhere.test/cookbook/main.js',
      '/another/main.js',
      '/cookbook/api/client.js',
      '/cookbook/missing.js',
      '/cookbook/api/assets/00000000-0000-4000-8000-000000000000/main.js',
      '/cookbook/%ZZ.js',
    ]
  ) {
    assertEquals(check(src, gone), null)
    if (src != gone) assertEquals(check('/cookbook/main.js', src), null)
  }
  assertEquals(check('/cookbook/main.js', gone, 1), null)
  assertEquals(check('/cookbook/main.js', gone, null), null)
  assertEquals(
    failedScript(
      { version: 2, message: 'x is not a function', file: gone },
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
      {
        version: 2,
        message: 'failed to load script /vite/assets/app.js',
        file: '/vite/assets/chunk.js',
      },
      release,
      'https://ada.yaks.app/vite/api/report',
      '/vite/',
      'dist',
    ),
    { script: 'dist/assets/app.js', missing: 'dist/assets/chunk.js' },
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

// A module a page's scripts import by address is fetched from its release,
// which never changes, rather than from the app's address, asked again on
// every load. The client a release's module reaches below the release is the
// one the page imports, so it runs once.
test("a page's imports by address follow its release", () => {
  let id = '3c92f71b-848e-4492-95e7-c73402b90ffc'
  let root = `/cookbook/api/assets/${id}/`
  let mapOf = (html: string, base = '/cookbook/') => {
    let served = assetMaps(
      html,
      '/cookbook/',
      '/cookbook/',
      id,
      () => false,
      base,
    )
    let map = /<script type="?importmap"?>(.*?)<\/script>/.exec(served)?.[1]
    return map ? JSON.parse(map).imports : null
  }
  let page = (script: string, type = 'module') =>
    `<!doctype html><head><title>t</title></head>` +
    `<script type="${type}">${script}</script>`
  assertEquals(
    mapOf(page(
      `import { a } from './cooking.js'\nimport './side.js'\n` +
        `export * from "../cookbook/lib/x.mjs"\nlet m = import('./later.js')\n` +
        `import { me } from './api/client.js'\nimport 'lit'\n` +
        `import('./' + name)\nimport x from 'https://cdn.example/x.js'`,
    )),
    {
      '/cookbook/cooking.js': `${root}cooking.js`,
      '/cookbook/side.js': `${root}side.js`,
      '/cookbook/lib/x.mjs': `${root}lib/x.mjs`,
      '/cookbook/later.js': `${root}later.js`,
      [`${root}api/`]: '/cookbook/api/',
    },
  )
  assertEquals(
    mapOf(page(`import './me.js'`), '/cookbook/about/')
      ?.['/cookbook/about/me.js'],
    `${root}about/me.js`,
  )
  // A classic script's dynamic import counts; a page with no module has no map.
  assertEquals(mapOf(page(`import('./a.js')`, 'text/javascript')), {
    '/cookbook/a.js': `${root}a.js`,
  })
  assertEquals(mapOf('<p>no scripts</p><script>let a = 1</script>'), null)
  assertEquals(mapOf(page(`"from": "./x.js"`, 'application/json')), null)
  // The map leads the head, ahead of every module and any policy.
  let served = assetMaps(
    page(`import './a.js'`).replace(
      '<title>',
      '<meta http-equiv="content-security-policy"><title>',
    ),
    '/cookbook/',
    '/cookbook/',
    id,
  )
  assertEquals(served.indexOf('<head><script type="importmap">'), 15)
  // An author's map takes the page's imports, keeping its own entry for one.
  let authored = assetMaps(
    `<script type=importmap>{"imports":{"./a.js":"./b.js"}}</script>` +
      `<script type=module>import './a.js'; import './c.js'</script>`,
    '/cookbook/',
    '/cookbook/',
    id,
  )
  assertEquals((authored.match(/importmap/g) ?? []).length, 1)
  assertEquals(
    JSON.parse(/importmap>(.*?)<\/script>/.exec(authored)![1]).imports,
    {
      '/cookbook/a.js': `${root}b.js`,
      '/cookbook/c.js': `${root}c.js`,
      [`${root}api/`]: '/cookbook/api/',
      [`${root}a.js`]: `${root}b.js`,
    },
  )
})
