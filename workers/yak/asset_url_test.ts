// A page's static references move as a release, while its app calls and links
// stay where the page put them.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import {
  apiOut,
  assetMaps,
  assetPath,
  assetUrl,
  releaseId,
  unfound,
} from './asset_url.ts'
import { platformPath } from './router.ts'

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

// A page of modules asks for the store client by the name of its bytes, which
// the browser keeps, and before its first module has said it imports it.
test('a page of modules imports the store client by its bytes, asked for beside the map', () => {
  let id = '3c92f71b-848e-4492-95e7-c73402b90ffc'
  let named = '/guestbook/api/client.0123456789.js'
  let served = (
    html: string,
    client: string | null = 'client.0123456789.js',
  ) => {
    let { document } = parseHTML(
      assetMaps(
        html,
        '/guestbook/',
        '/guestbook/',
        id,
        () => false,
        '/guestbook/',
        client,
      ),
    )
    let map = document.querySelector('script[type="importmap"]')
    return {
      imports: map ? JSON.parse(map.textContent!).imports : null,
      preloads: [...document.querySelectorAll('link[rel="modulepreload"]')]
        .map((link) => link.getAttribute('href')),
      next: map?.nextElementSibling?.getAttribute('rel'),
    }
  }
  let page = `<head></head><script type="module" src="./app.js"></script>`
  let { imports, preloads, next } = served(page)
  assertEquals(imports['/guestbook/api/client.js'], named)
  assertEquals(imports[`/guestbook/api/assets/${id}/api/client.js`], named)
  assertEquals([preloads, next], [[named], 'modulepreload'])
  // Into an author's map, unless the author maps the client elsewhere.
  let theirs = (imports: object) =>
    served(
      `<script type="importmap">${JSON.stringify({ imports })}</script>` + page,
    )
  assertEquals(theirs({ lit: './lit.js' }).preloads, [named])
  assertEquals(theirs({ './api/client.js': './mine.js' }).preloads, [])
  // No module, or no name, asks for nothing more.
  assertEquals(served('<script>let a = 1</script>').preloads, [])
  let unnamed = served(page, null)
  assertEquals(
    [unnamed.imports['/guestbook/api/client.js'], unnamed.preloads],
    [undefined, []],
  )
})

// What a release's pages load that it does not hold, as `file names ref`, so
// each case is its files and what they leave missing.
let missing = async (
  files: Record<string, string>,
  folder = '',
  rooted = false,
) =>
  (await unfound(
    Object.keys(files),
    (path) => Promise.resolve(files[path] ?? null),
    folder,
    rooted,
    platformPath,
  )).map((m) => `${m.file} ${m.imports ? 'imports' : 'loads'} ${m.missing}`)

test("a release's pages and modules name every file they load", async () => {
  // The case of bug 2badcf95: a module importing a sibling nobody deployed.
  assertEquals(
    await missing({
      'admin/index.html': '<script type="module" src="admin.js"></script>',
      'admin/admin.js': "import { queue } from './queue.js'\nqueue()",
    }),
    ['admin/admin.js imports admin/queue.js'],
  )
  // Every element that loads a file, and an inline module's imports.
  assertEquals(
    await missing({
      'index.html': [
        '<link rel="stylesheet" href="/style.css">',
        '<link rel="icon" href="favicon.png">',
        '<link rel="preload" as="font" href="font.woff2">',
        '<img src="logo.png"><video poster="still.jpg"></video>',
        "<script type=\"module\">import './main.js'; import('./later.js')</script>",
      ].join(''),
      'main.js': "export * from '../lib/util.mjs'",
    }),
    [
      'index.html imports later.js',
      'index.html loads style.css',
      'index.html loads font.woff2',
      'index.html loads logo.png',
      'index.html loads still.jpg',
      'main.js imports lib/util.mjs',
    ],
  )
  // What is present, or not the release's to hold, is no gap: pages and
  // routes, other origins, the app's API and the platform's paths, npm names,
  // the compile's packages, and what a comment says.
  assertEquals(
    await missing({
      'index.html': [
        '<a href="missing.png">',
        '<script src="app.js"></script><script src="main.ts"></script>',
        '<img src="https://cdn.example/x.png"><img src="//cdn.example/y.png">',
        '<img src="data:image/png;base64,AA"><img src="about"><img src="">',
        '<script type="module" src="./api/client.js"></script>',
        '<script src="/_yaks/badge.js"></script><img src="/icon.png">',
        '<!-- <img src="old.png"> -->',
        '<script type="importmap">{"imports": {"x": "./gone.js"}}</script>',
      ].join(''),
      'app.js': [
        "import { h } from 'preact'",
        "import '/__packages/preact/mod.js'",
        "// import './old.js'",
        "/* import './older.js' */",
        "import './app.js'",
      ].join('\n'),
      'main.ts': "import './missing.ts'",
    }),
    [],
  )
  // A served folder holds what its pages load, and what is outside it is
  // source; a rooted app's folder pages resolve from the root.
  assertEquals(
    await missing({
      'dist/index.html': '<script src="app.js"></script>',
      'app.js': '',
      'dist/docs/index.html': '<img src="../logo.png">',
      'dist/logo.png': '',
    }, 'dist'),
    ['dist/index.html loads dist/app.js'],
  )
  assertEquals(
    await missing(
      {
        'docs/index.html': '<img src="logo.png">',
        'logo.png': '',
      },
      '',
      true,
    ),
    [],
  )
  // A page's own `<base>` is where its addresses resolve from.
  assertEquals(
    await missing({
      'docs/a.html': '<base href="/"><img src="logo.png">',
      'docs/b.html': '<base href="https://cdn.example/"><img src="gone.png">',
      'logo.png': '',
    }),
    [],
  )
})
