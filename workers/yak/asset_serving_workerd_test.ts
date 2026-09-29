// Published app assets keep their release bytes through later deploys and a
// rollback, while the page and ordinary file paths follow the live release.
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'
import { connector, seed, workerd } from './probe.ts'

Deno.test('a page uses release assets whose bytes survive deploy and rollback', async () => {
  let k = workerd()
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
              '<script type="module" src="./scripts/main.js"></script>' +
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
            content: `body{background:url('../images/bg.svg')}/*${version}*/`,
          },
          { path: 'images/bg.svg', content: `<svg>${version}</svg>` },
          {
            path: 'scripts/main.js',
            content:
              `import './chunk.js'; new Worker(new URL('./worker.js', import.meta.url)); /*${version}*/`,
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
    let firstPage = await at('/page/')
    let firstTag = firstPage.headers.get('etag')
    let first = await firstPage.text()
    let css1 = asset(first, 'css')
    let js1 = asset(first, 'js')
    assertStringIncludes(first, '<h1>page</h1>')
    assertStringIncludes(first, '<a href="./next.html">')
    assertStringIncludes(first, '<form action="./api/apply">')
    let custom = await (await at('/page/custom.html')).text()
    assertStringIncludes(custom, '<base href="https://cdn.example/">')
    assertStringIncludes(custom, '<script src="./scripts/main.js">')
    let css = await at(css1)
    assertEquals(css.status, 200)
    assertEquals(
      css.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    )
    assertStringIncludes(await css.text(), '/*first*/')
    let image = new URL('../images/bg.svg', `https://${host}${css1}`)
    assertStringIncludes(await (await at(image.pathname)).text(), 'first')
    let chunk = new URL('./chunk.js', `https://${host}${js1}`)
    let worker = new URL('./worker.js', `https://${host}${js1}`)
    assertStringIncludes(await (await at(chunk.pathname)).text(), 'first')
    assertStringIncludes(await (await at(worker.pathname)).text(), 'first')
    let head = await at(css1, { method: 'HEAD' })
    assertEquals(head.status, 200)
    assertEquals(
      head.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    )
    assertEquals(await head.text(), '')
    let range = await at(css1, { headers: { range: 'bytes=0-3' } })
    assertEquals(range.status, 206)
    assertEquals(await range.text(), 'body')

    await wrote('second')
    let conditional = await at('/page/', {
      headers: { 'if-none-match': firstTag! },
    })
    assertEquals(conditional.status, 200)
    let second = await conditional.text()
    let css2 = asset(second, 'css')
    assertMatch(second, /<h1>page<\/h1>/)
    assertEquals(css1 == css2, false)
    assertStringIncludes(await (await at(css1)).text(), '/*first*/')
    assertStringIncludes(await (await at(css2)).text(), '/*second*/')
    assertStringIncludes(
      await (await at('/page/styles/main.css')).text(),
      '/*second*/',
    )

    await agent.tool('app_rollback', app)
    assertStringIncludes(await page(), '<h1>page</h1>')
    assertStringIncludes(await (await at(css1)).text(), '/*first*/')
    assertStringIncludes(await (await at(css2)).text(), '/*second*/')

    await agent.tool('app_set', { ...app, access: 'private' })
    assertEquals((await at(css1)).status, 401)
    let member = await at(css1, { headers: { cookie } })
    assertEquals(member.status, 200)
    assertStringIncludes(await member.text(), '/*first*/')

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
    assertStringIncludes(await tokenRead.text(), '/*first*/')
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
