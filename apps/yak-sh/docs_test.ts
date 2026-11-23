// What an agent reads at yak.sh, asked of the app's worker as yaks.app asks it.
import { equal, match, test } from '@yaks/testing'
import worker from './worker.ts'
import { INSTALL, SECTIONS } from './site.ts'
import { INSTALLER } from './install.ts'

let get = async (url: string, headers: HeadersInit = {}) => {
  let res = await worker.fetch(new Request(url, { headers }))
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    text: await res.text(),
  }
}

test('llms.txt says what yak is and links pages the site answers', async () => {
  let { status, type, text } = await get('https://yak.sh/llms.txt')
  equal([status, type], [200, 'text/plain; charset=utf-8'])
  match(text, /^# yak\.sh\n\n> `yak` is a command line/)
  let own = [...text.matchAll(/\]\((https:\/\/yak\.sh\/[^)]*)\)/g)]
    .map((m) => m[1])
  equal(own, ['https://yak.sh/setup.md', 'https://yak.sh/index.md'])
  for (let url of own) {
    equal((await get(url)).type, 'text/markdown; charset=utf-8')
  }
})

test('the pages link under the address the visitor asked for', async () => {
  let { text } = await get('https://jeff.yaks.app/yak-sh/llms.txt')
  match(text, /\(https:\/\/jeff\.yaks\.app\/yak-sh\/setup\.md\)/)
  let domain = await get('https://jeff.yaks.app/yak-sh/llms.txt', {
    'x-yak-address': 'https://yak.sh/llms.txt',
  })
  match(domain.text, /\(https:\/\/yak\.sh\/setup\.md\)/)
})

test('setup.md holds the steps from installing yak to an app online', async () => {
  let { text } = await get('https://yak.sh/setup.md')
  for (
    let line of [INSTALL, 'yak init', 'yak auth yaks.app', 'yak app_deploy']
  ) match(text, new RegExp(`\n${line}`))
  match(text, /https:\/\/yaks\.app\/agent\.md/)
})

test("index.md is every section, without the page's own blocks", async () => {
  let { text } = await get('https://yak.sh/index.md')
  for (let s of SECTIONS) {
    match(text, new RegExp(`^#+ ${RegExp.escape(s.title)}$`, 'm'))
  }
  equal(/```(declared|outbox|reply|session)/.test(text), false)
  match(text, /```mcp\ntask_update/)
})

test('anything else falls through to the files', async () => {
  for (let url of ['https://yak.sh/', 'https://yak.sh/site.ts']) {
    equal((await get(url)).status, 404)
  }
})

test('robots.txt welcomes crawlers and names the sitemap', async () => {
  let { status, type, text } = await get('https://yak.sh/robots.txt')
  equal([status, type], [200, 'text/plain; charset=utf-8'])
  equal(
    text,
    'User-agent: *\nAllow: /\n\nSitemap: https://yak.sh/sitemap.xml\n',
  )
})

test('sitemap.xml lists the page and each doc indexed at its own address', async () => {
  let { type, text } = await get('https://yak.sh/sitemap.xml')
  equal(type, 'application/xml; charset=utf-8')
  let locs = [...text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
  equal(locs, [
    'https://yak.sh/',
    'https://yak.sh/llms.txt',
    'https://yak.sh/setup.md',
  ])
  for (let url of locs.slice(1)) equal((await get(url)).status, 200)
})

test('index.md names the page as its canonical address', async () => {
  let res = await worker.fetch(new Request('https://yak.sh/index.md'))
  equal(res.headers.get('link'), '<https://yak.sh/>; rel="canonical"')
})

test('opening an agent document in a browser wraps its source without changing the raw response', async () => {
  let url = 'https://yak.sh/sitemap.xml'
  let browser = { accept: 'text/html', 'sec-fetch-mode': 'navigate' }
  let shown = await get(url, browser)
  equal(shown.type, 'text/html; charset=utf-8')
  match(shown.text, /name="viewport"/)
  match(shown.text, /&lt;loc&gt;https:\/\/yak\.sh\/&lt;\/loc&gt;/)
  equal(await get(`${url}?raw=1`, browser), await get(url))
})

test('the install line fetches a shell script that installs yak from jsr.io', async () => {
  match(INSTALL, new RegExp(`^curl -fsSL ${RegExp.escape(INSTALLER)} \\| sh$`))
  let { status, type, text } = await get(INSTALLER)
  equal([status, type], [200, 'text/plain; charset=utf-8'])
  match(text, /^#!\/bin\/sh\n/)
  match(text, /\n"\$deno" run -A jsr:@yaks\/cli\/install\n/)
  let sh = new Deno.Command('sh', { args: ['-n'], stdin: 'piped' }).spawn()
  let writer = sh.stdin.getWriter()
  await writer.write(new TextEncoder().encode(text))
  await writer.close()
  equal((await sh.status).code, 0)
})
