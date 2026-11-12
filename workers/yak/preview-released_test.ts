// app_preview with released: true opens the released app at its own address,
// over its live store: a public app as a visitor sees it, a private one as
// the caller does, signed in for that render alone (preview.ts `released`).
// The browser here loads the page through the kernel with the cookies it was
// handed, so what it reads is what the address answers them.
import { cleanup, equal, test } from '@yaks/testing'
import { assertRejects, assertStringIncludes } from '@std/assert'
import { answer, type Browsing, type Visit } from './browser/capture.ts'
import { connector, fresh, type Kernel, seed } from './probe.ts'
import { verify } from './lib/token.ts'

let visits: Visit[] = []
let k: Kernel
let browsing: Browsing = {
  acquire: () => Promise.resolve('session'),
  connect: () => {
    let visit = visits.at(-1)!
    let text = ''
    return Promise.resolve({
      newPage: () =>
        Promise.resolve({
          on: () => {},
          setViewport: () => Promise.resolve(),
          setCookie: () => Promise.resolve(),
          goto: async (url: string) => {
            let { host, pathname } = new URL(url)
            let cookie = (visit.cookies ?? [])
              .map((c) => `${c.name}=${c.value}`).join('; ')
            let r = await k.at(host, pathname, { headers: { cookie } })
            text = await r.text()
            return { status: () => r.status }
          },
          createCDPSession: () =>
            Promise.resolve({
              send: (method: string, params?: { expression?: string }) => {
                let audited = params?.expression?.includes('innerText')
                  ? text
                  : { violations: [], incomplete: [] }
                return Promise.resolve(
                  method == 'Page.getFrameTree'
                    ? { frameTree: { frame: { id: 'main' } } }
                    : method == 'Page.createIsolatedWorld'
                    ? { executionContextId: 1 }
                    : { result: { value: audited } },
                )
              },
            }),
          screenshot: () => Promise.resolve('png'),
        }),
      close: () => Promise.resolve(),
    })
  },
  axe: { source: '', version: 'test' },
}
let rendering = answer(browsing)
k = await fresh({}, (env) => {
  env.BROWSER = {
    fetch: async (req: Request) => {
      visits.push(await req.clone().json())
      return rendering(req)
    },
  } as unknown as typeof env.BROWSER
})

cleanup(() => k.stop())

let space = `rel${crypto.randomUUID().slice(0, 8)}`
let owner = await seed(k, [{ slug: space, apps: ['shut', 'open'] }])
let agent = connector(k, owner.cookie)
for (let app of ['shut', 'open']) {
  await agent.tool('app_files', {
    space,
    app,
    path: 'index.html',
    content: `<html><body>The ${app} release</body></html>`,
  })
  await agent.tool('app_deploy', { space, app })
}
await agent.tool('app_set', { space, app: 'shut', access: 'private' })
let opened = (app: string) =>
  agent.answer('app_preview', { space, app, released: true })

test('a private release opens signed in as the caller, for its space alone', async () => {
  let said = await opened('shut')
  let visit = visits.at(-1)!
  equal(visit.url, `https://${space}.${k.host}/shut/`)
  let [cookie] = visit.cookies!
  let claims = await verify(cookie.value, k.secret)
  equal([claims?.person, claims?.space], [owner.person, owner.eids[space]])
  equal(cookie.domain, `${space}.${k.host}`)
  assertStringIncludes(String(said.text), 'as you see it signed in')
  assertStringIncludes(String(said.text), 'The shut release')
})

test('a public release opens as a visitor sees it', async () => {
  let said = await opened('open')
  equal(visits.at(-1)!.cookies, [])
  assertStringIncludes(String(said.text), 'as a visitor sees it')
  assertStringIncludes(String(said.text), 'The open release')
})

test('an app never released has nothing to open', async () => {
  await agent.tool('app_new', { space, slug: 'unborn', title: 'Unborn' })
  await assertRejects(
    () => agent.answer('app_preview', { space, app: 'unborn', released: true }),
    Error,
    'has no release yet',
  )
})
