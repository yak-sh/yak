// An app's splash (@yaks/platform/splash): drawn when it is released, from
// its icon and its sheets' background, named in its pages and manifest, and
// served for good to anyone holding the address.
import { assert, assertStringIncludes } from '@std/assert'
import { equal, test } from '@yaks/testing'
import { connector, fresh, seed } from './probe.ts'

let PNG = new Uint8Array([137, 80, 78, 71])
let SHEET = ':root { --bg: #fbf4e4 } body { background: var(--bg) }' +
  '@media (prefers-color-scheme: dark) { :root { --bg: #222 } }'

test("a release draws its app's splash once, and its pages and manifest name it", async () => {
  let drawn: string[] = []
  let k = await fresh({
    RASTER: {
      fetch: async (req: Request) => {
        if (new URL(req.url).searchParams.has('width')) {
          drawn.push(await req.text())
        }
        return new Response(PNG)
      },
    },
  })
  try {
    let space = 'splash-fixture'
    let person = await seed(k, [{ slug: space, apps: ['cards'] }])
    let agent = connector(k, person.cookie)
    let release = async () => {
      await agent.tool('app_files', {
        app: 'cards',
        space,
        files: [
          {
            path: 'index.html',
            content: '<link rel="stylesheet" href="style.css"><p>Hi</p>',
          },
          { path: 'style.css', content: SHEET },
          {
            path: 'icon.svg',
            content: '<svg xmlns="http://www.w3.org/2000/svg" ' +
              'viewBox="0 0 24 24"><rect width="24" height="24"/></svg>',
          },
        ],
      })
      await agent.tool('app_deploy', { app: 'cards', space })
      await k.settled()
    }
    await release()
    let host = `${space}.${k.host}`
    let get = (path: string, cookie = person.cookie) =>
      k.at(host, path, { headers: cookie ? { cookie } : {} })

    let page = await (await get('/cards/')).text()
    let links = [...page.matchAll(
      /<link rel="apple-touch-startup-image" href="([^"]+)" media="([^"]+)">/g,
    )]
    equal(links.length + 1, drawn.length)
    assert(drawn.some((svg) => svg.includes('fill="#fbf4e4"')))
    assert(drawn.some((svg) => svg.includes('fill="#222222"')))
    assertStringIncludes(links.at(-1)![2], '(prefers-color-scheme: dark)')

    let image = await get(new URL(links[0][1], 'https://x').pathname, '')
    equal(image.status, 200)
    equal(new Uint8Array(await image.arrayBuffer()), PNG)
    assertStringIncludes(image.headers.get('cache-control')!, 'immutable')

    let manifest = await (await get('/cards/manifest.webmanifest')).json()
    assert(manifest.icons[0].src.endsWith('/icon-512.png'))

    let once = drawn.length
    await release()
    equal(drawn.length, once)
  } finally {
    await k.stop()
  }
})
