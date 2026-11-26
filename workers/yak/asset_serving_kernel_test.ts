// Published app assets keep their release bytes through later deploys and a
// rollback, while the page and ordinary file paths follow the live release.
import { test } from '@yaks/testing'
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import { digest } from '@yaks/graph/sha256'
import { addressed } from '@yaks/platform/versions'
import { bucket } from './binding-probe.ts'
import { r2RawObjects } from './lib/objects.ts'
import { KERNEL } from './meta.ts'
import { encode, META } from '@yaks/platform/release-index'
import { connector, fresh, kernel, seed } from './probe.ts'

test('a private app icon from an older release revalidates on both domains', async () => {
  let { r2 } = bucket()
  let k = await fresh({ BLOBS: r2 })
  try {
    let space = 'iconcache'
    let { cookie, eids } = await seed(k, [{ slug: space, apps: ['chores'] }])
    let app = eids[space + '/chores']
    let source = `${space}/.releases/${app}/${crypto.randomUUID()}`
    let domain = 'iconcache.example'
    let svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    let sha = await digest(svg)
    let key = addressed(sha)
    let raw = r2RawObjects(r2)
    await raw.put(key, new TextEncoder().encode(svg))
    await raw.put(source + META, encode({ 'icon.svg': { key, sha } }))
    await k.dir.apply({
      entities: [
        {
          entity: { eid: app },
          app: { access: 'private', source, worker: '' },
        },
        {
          entity: { eid: crypto.randomUUID() },
          hostname: { name: domain, serves: app, stage: 'active' },
        },
      ],
    }, KERNEL)

    let cache = 'private, max-age=60, must-revalidate'
    for (
      let [host, path] of [
        [`${space}.yaks.app`, '/chores/icon.svg'],
        [domain, '/icon.svg'],
      ]
    ) {
      let image = (headers: Record<string, string>) =>
        k.at(host, path, {
          redirect: 'manual',
          headers,
        })
      let loaded = await image({ cookie })
      assertEquals(loaded.status, 200, host)
      assertEquals(loaded.headers.get('cache-control'), cache, host)
      assertEquals(await loaded.text(), svg, host)
      let tag = loaded.headers.get('etag')!
      assertMatch(tag, /^"[0-9a-f]+"$/)
      let held = await image({ cookie, 'if-none-match': tag })
      assertEquals(held.status, 304, host)
      assertEquals(held.headers.get('cache-control'), cache, host)
      assertEquals(await held.text(), '')
      let signedOut = await image({ 'if-none-match': tag })
      assertEquals(signedOut.status, 303, host)
      await signedOut.body?.cancel()

      let moved = await image({ cookie, 'sec-fetch-dest': 'image' })
      let named = moved.headers.get('location')!
      assertEquals(moved.status, 307)
      assertEquals(
        named,
        path.replace('/icon.svg', `/api/assets/${sha}/icon.svg`),
      )
      let file = await k.at(host, named, { headers: { cookie } })
      assertEquals(
        file.headers.get('cache-control'),
        'private, max-age=31536000, immutable',
      )
      assertEquals(await file.text(), svg)
    }
  } finally {
    await k.stop()
  }
})

test('a page uses release assets whose bytes survive deploy and rollback', async () => {
  let k = await kernel()
  try {
    let space = 'releaseassets'
    let app = { space, app: 'page' }
    let { cookie } = await seed(k, [{ slug: space, apps: ['page'] }])
    let agent = connector(k, cookie)
    let host = `${space}.yaks.app`
    let at = (path: string, init: RequestInit = {}) => k.at(host, path, init)
    let wrote = async (version: string) => {
      await agent.tool('app_files', {
        ...app,
        files: [
          {
            path: 'index.html',
            content: '<link rel="stylesheet" href="./styles/main.css">' +
              '<script type=importmap>{"imports":{' +
              '"@local":"./scripts/chunk.js"},"scopes":{' +
              '"./scripts/":{"@scope":"./scripts/worker.js"}}}' +
              '</script>' +
              '<script type="module" src="./scripts/main.js"></script>' +
              '<script type="module" src="./scripts/static.js"></script>' +
              `<script type="module">import { v } from './scripts/chunk.js'` +
              '</script>' +
              '<a href="./next.html">next</a>' +
              '<form action="./api/apply"></form><h1>page</h1>',
          },
          {
            path: 'custom.html',
            content: '<base href="https://cdn.example/">' +
              '<script src="./scripts/main.js"></script>',
          },
          {
            path: 'styles/main.css',
            content: "body{background:url('../images/bg.svg')}",
          },
          { path: 'images/bg.svg', content: `<svg>${version}</svg>` },
          { path: 'images/kept.svg', content: '<svg/>' },
          {
            path: 'docs/index.html',
            content: '<link rel="stylesheet" href="../styles/main.css">' +
              '<h1>docs</h1><img src="../images/kept.svg">',
          },
          {
            path: 'scripts/main.js',
            content:
              "import './chunk.js'; export let load = (name) => import('./' + name); " +
              "new Worker(new URL('./worker.js', import.meta.url));",
          },
          {
            path: 'scripts/static.js',
            content: "export { v } from './chunk.js'",
          },
          { path: 'scripts/chunk.js', content: `export let v = '${version}'` },
          { path: 'scripts/worker.js', content: `self.v = '${version}'` },
        ],
      })
      await agent.tool('app_deploy', app)
    }
    let page = async () => (await at('/page/')).text()
    let asset = (html: string, kind: 'css' | 'js') => {
      let name = kind == 'css' ? 'styles/main.css' : 'scripts/main.js'
      let found = html.match(new RegExp(`/page/api/assets/[0-9a-f-]+/${name}`))
      if (!found) throw new Error(`page did not name ${name}: ${html}`)
      return found[0]
    }

    await wrote('first')
    let bare = '/page/images/bg.svg?view=grid'
    let imageHeaders = { 'sec-fetch-dest': 'image' }
    let plain = await at(bare, { headers: imageHeaders })
    assertEquals(plain.status, 200)
    let plainCache = plain.headers.get('cache-control')
    assertEquals(plainCache, 'public, max-age=60, stale-while-revalidate=300')
    let plainTag = plain.headers.get('etag')!
    assertMatch(plainTag, /^"[0-9a-f]+"$/)
    assertEquals(await plain.text(), '<svg>first</svg>')
    let readAgain = await at(bare, {
      headers: { ...imageHeaders, cookie, 'if-none-match': plainTag },
    })
    assertEquals(readAgain.status, 304)
    assertEquals(readAgain.headers.get('cache-control'), plainCache)
    assertEquals(readAgain.headers.get('etag'), plainTag)
    assertEquals(await readAgain.text(), '')
    let plainHead = await at(bare, { method: 'HEAD' })
    assertEquals(plainHead.headers.get('cache-control'), plainCache)
    assertEquals(plainHead.headers.get('etag'), plainTag)
    assertEquals(await plainHead.text(), '')

    let firstPage = await at('/page/')
    let firstTag = firstPage.headers.get('etag')
    let first = await firstPage.text()
    let css1 = asset(first, 'css')
    let js1 = asset(first, 'js')
    let release1 = js1.match(/\/assets\/([0-9a-f-]+)\//)![1]
    assertMatch(release1, /^[0-9a-f-]{36}$/)
    assertStringIncludes(first, '<h1>page</h1>')
    assertStringIncludes(first, `"/page/api/assets/${release1}/scripts/":`)
    // The page's own module imports its release's file, which the browser
    // keeps, and a release module's client is the page's.
    let imports = (html: string) =>
      JSON.parse(/<script type=importmap>(.*?)<\/script>/.exec(html)![1])
        .imports
    let chunk1 = imports(first)['/page/scripts/chunk.js']
    assertMatch(chunk1, /assets\/[a-f0-9]{64}\/scripts\/chunk\.js$/)
    assertEquals(imports(first)['@local'], chunk1)
    let entry =
      first.match(/\/page\/api\/assets\/[a-f0-9]{64}\/scripts\/static\.js/)![0]
    let code = await (await at(entry)).text()
    assertStringIncludes(entry, await digest(code))
    assertEquals(
      new URL(code.split("'")[1], `https://${host}${entry}`).pathname,
      chunk1,
    )
    assertEquals(
      imports(first)[`/page/api/assets/${release1}/api/`],
      '/page/api/',
    )
    let kept = await at(chunk1)
    assertEquals(
      kept.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    )
    assertEquals(await kept.text(), "export let v = 'first'")
    assertStringIncludes(first, '<a href="./next.html">')
    assertStringIncludes(first, '<form action="./api/apply">')
    // A page in a folder is sent to its folder's address by the bound files
    // door too, and resolves from there into the same release.
    let folder = await at('/page/docs', { redirect: 'manual' })
    assertEquals(folder.status, 307)
    assertEquals(folder.headers.get('location'), 'docs/')
    let docs = await (await at('/page/docs/')).text()
    assertStringIncludes(docs, '<base href="/page/docs/">')
    assertStringIncludes(docs, `href="${css1}"`)
    let custom = await (await at('/page/custom.html')).text()
    assertStringIncludes(custom, '<base href="https://cdn.example/">')
    assertStringIncludes(custom, '<script src="./scripts/main.js">')
    let css = await at(css1)
    assertEquals(css.status, 200)
    assertEquals(
      css.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    )
    let sheet = await css.text()
    assertStringIncludes(css1, await digest(sheet))
    let image = new URL(sheet.split("'")[1], `https://${host}${css1}`)
    assertStringIncludes(await (await at(image.pathname)).text(), 'first')
    let chunk = new URL('./chunk.js', `https://${host}${js1}`)
    let worker = new URL('./worker.js', `https://${host}${js1}`)
    assertStringIncludes(await (await at(chunk.pathname)).text(), 'first')
    assertStringIncludes(await (await at(worker.pathname)).text(), 'first')
    let head = await at(css1, { method: 'HEAD' })
    assertEquals(head.status, 200)
    assertEquals(
      head.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    )
    assertEquals(await head.text(), '')
    let range = await at(css1, { headers: { range: 'bytes=0-3' } })
    assertEquals(range.status, 206)
    assertEquals(await range.text(), 'body')

    await wrote('second')
    let changedImage = await at(bare, {
      headers: { 'if-none-match': plainTag },
    })
    assertEquals(changedImage.status, 200)
    assertEquals(await changedImage.text(), '<svg>second</svg>')
    let conditional = await at('/page/', {
      headers: { 'if-none-match': firstTag! },
    })
    assertEquals(conditional.status, 200)
    let second = await conditional.text()
    let css2 = asset(second, 'css')
    assertMatch(second, /<h1>page<\/h1>/)
    assertEquals(css1 == css2, false)
    assertEquals(await (await at(css1)).text(), sheet)
    let changed = await (await at(css2)).text()
    assertStringIncludes(css2, await digest(changed))
    assertEquals(
      (await (await at('/page/docs/')).text()).match(
        /\/page\/api\/assets\/[a-f0-9]{64}\/images\/kept\.svg/,
      )?.[0],
      docs.match(/\/page\/api\/assets\/[a-f0-9]{64}\/images\/kept\.svg/)?.[0],
    )
    // A deploy moves the import, and the old release keeps its bytes.
    let chunk2 = imports(second)['/page/scripts/chunk.js']
    assertEquals(imports(second)['@local'], chunk2)
    assertEquals(await (await at(chunk2)).text(), "export let v = 'second'")
    assertEquals(await (await at(chunk1)).text(), "export let v = 'first'")
    assertStringIncludes(
      await (await at('/page/styles/main.css')).text(),
      '../images/bg.svg',
    )

    await agent.tool('app_rollback', app)
    assertStringIncludes(await page(), '<h1>page</h1>')
    assertEquals(await (await at(css1)).text(), sheet)
    assertEquals(await (await at(css2)).text(), changed)

    await agent.tool('app_set', { ...app, access: 'private' })
    let signedOut = await at(bare, {
      headers: { ...imageHeaders, 'if-none-match': plainTag },
      redirect: 'manual',
    })
    assertEquals(signedOut.status, 303)
    let privateImage = await at(bare, { headers: { ...imageHeaders, cookie } })
    assertEquals(privateImage.status, 200)
    assertEquals(
      privateImage.headers.get('cache-control'),
      'private, max-age=60, must-revalidate',
    )
    assertEquals(await privateImage.text(), '<svg>first</svg>')
    let privateAgain = await at(bare, {
      headers: { ...imageHeaders, cookie, 'if-none-match': plainTag },
    })
    assertEquals(privateAgain.status, 304)
    assertEquals(privateAgain.headers.get('etag'), plainTag)
    assertEquals((await at(css1)).status, 401)
    let member = await at(css1, { headers: { cookie } })
    assertEquals(member.status, 200)
    assertEquals(
      member.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    )
    assertEquals(await member.text(), sheet)

    await agent.tool('app_set', { ...app, access: 'public' })
    let name = `asset-release-${crypto.randomUUID()}`
    await agent.tool('app_publish', { ...app, name })
    await agent.tool('app_install', { space, name, as: 'copy' })
    let copy = { space, app: 'copy' }
    await agent.tool('app_set', { ...copy, sandboxed: true })
    await agent.tool('app_deploy', copy)
    await agent.tool('app_set', { ...copy, access: 'private' })
    let sandboxPage = await at('/copy/', { headers: { cookie } })
    let sandboxHtml = await sandboxPage.text()
    let tokenAsset = sandboxHtml.match(
      /\/copy\/~[^/]+\/api\/assets\/[0-9a-f-]+\/styles\/main\.css/,
    )?.[0]
    if (!tokenAsset) {
      throw new Error(`sandbox page has no asset: ${sandboxHtml}`)
    }
    let tokenRead = await at(tokenAsset)
    assertEquals(tokenRead.status, 200)
    assertEquals(await tokenRead.text(), sheet)
    let failed = tokenAsset.replace(
      /\/assets\/[0-9a-f-]+\//,
      `/assets/${crypto.randomUUID()}/`,
    )
    assertEquals((await at(failed)).status, 404)
    assertEquals((await at(tokenAsset.replace(/~[^/]+/, '~bogus'))).status, 401)
    assertEquals((await at(tokenAsset.replace(/~[^/]+\//, ''))).status, 401)
  } finally {
    await k.stop()
  }
})

// A private app's offered release is anyone's, as installing hands it out;
// its others stay its people's, though a stranger learned their ids (T-711).
test("a stranger reads a private app's offered release, never its others", async () => {
  let k = await kernel()
  try {
    let space = 'offeredrelease'
    let app = { space, app: 'notes' }
    let { cookie } = await seed(k, [{ slug: space, apps: ['notes'] }])
    let agent = connector(k, cookie)
    let at = (path: string, init: RequestInit = {}) =>
      k.at(`${space}.yaks.app`, path, init)
    await agent.tool('app_set', { ...app, access: 'private' })
    let release = async (n: number) => {
      await agent.tool('app_files', {
        ...app,
        files: [
          {
            path: 'index.html',
            content: '<script type="module" src="./app.js"></script>',
          },
          { path: 'app.js', content: `export let v = ${n}` },
        ],
      })
      await agent.tool('app_deploy', app)
      let page = await (await at('/notes/', { headers: { cookie } })).text()
      return page.match(/\/notes\/api\/assets\/[0-9a-f-]+\/app\.js/)![0]
    }
    let [v1, v2] = [await release(1), await release(2)]
    await agent.tool('app_publish', {
      ...app,
      name: `offered-${crypto.randomUUID()}`,
    })
    let v3 = await release(3)
    let read = async (path: string, init?: RequestInit) => {
      let got = await at(path, init)
      return [got.status, got.status == 200 ? await got.text() : null]
    }
    // Signed out, and on a visit to the sample, whose page weaves v2.
    let visited = await at('/notes/')
    let visit = visited.headers.get('set-cookie')!.split(';')[0]
    assertStringIncludes(await visited.text(), v2)
    for (let headers of [{}, { cookie: visit }] as HeadersInit[]) {
      assertEquals(
        await Promise.all([v1, v2, v3].map((v) => read(v, { headers }))),
        [[401, null], [200, 'export let v = 2'], [401, null]],
      )
    }
    assertEquals(
      await Promise.all([v1, v3].map((v) => read(v, { headers: { cookie } }))),
      [[200, 'export let v = 1'], [200, 'export let v = 3']],
    )
  } finally {
    await k.stop()
  }
})
