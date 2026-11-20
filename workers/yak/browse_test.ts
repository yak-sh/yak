// The browse door (browse.ts): a page of ours opened in the browser signed in
// as its caller, for the platform's test accounts and owners alone.
import { cleanup, equal, test } from '@yaks/testing'
import { answer, type Browsing, type Visit } from './browser/capture.ts'
import { actions } from './browser/testing.ts'
import { fresh, type Kernel, signIn } from './probe.ts'
import { HOST_COOKIE } from './browser-cookie.ts'
import { COOKIE, cookieValue } from '@yaks/platform/cookie'

let visits: Visit[] = []
let did: string[] = []
let browsing: Browsing = {
  acquire: () => Promise.resolve('session'),
  connect: () =>
    Promise.resolve({
      newPage: () =>
        Promise.resolve({
          ...actions((line) => did.push(line)),
          on: () => {},
          setViewport: () => Promise.resolve(),
          setCookie: () => Promise.resolve(),
          goto: () => Promise.resolve({ status: () => 200 }),
          createCDPSession: () =>
            Promise.resolve({
              send: (method: string) =>
                Promise.resolve(
                  method == 'Page.getFrameTree'
                    ? { frameTree: { frame: { id: 'main' } } }
                    : method == 'Page.createIsolatedWorld'
                    ? { executionContextId: 1 }
                    : { result: { value: { violations: [], incomplete: [] } } },
                ),
            }),
          screenshot: () => Promise.resolve('png'),
        }),
      close: () => Promise.resolve(),
    }),
  axe: { source: '', version: 'test' },
}
let rendering = answer(browsing)
let k: Kernel = await fresh({}, (env) => {
  env.BROWSER = {
    fetch: async (req: Request) => {
      visits.push(await req.clone().json())
      return rendering(req)
    },
  } as unknown as typeof env.BROWSER
})
cleanup(() => k.stop())

// The kernel's first sign-in owns the platform's space.
let owner = k.owner
let checks = await signIn(
  k,
  `checks${crypto.randomUUID().slice(0, 6)}@bot.yak.sh`,
)
let stranger = await signIn(k)

let browse = (body: unknown, headers: Record<string, string>) =>
  k.at(k.host, '/api/browse', {
    method: 'POST',
    headers: { origin: `https://${k.host}`, ...headers },
    body: JSON.stringify(body),
  })
let manage = { url: `https://${k.host}/manage`, steps: [{ tap: 'textarea' }] }

test('a test account opens a page of ours signed in as itself, on a phone unless it names a window', async () => {
  let r = await browse(manage, { cookie: checks.cookie })
  equal(r.status, 200)
  equal((await r.json()).image, 'png')
  let visit = visits.at(-1)!
  let token = cookieValue(checks.cookie) ?? undefined
  equal(visit.url, `https://${k.host}/manage`)
  equal(visit.view, { width: 390, height: 844, wait: 1000, touch: true })
  equal(
    visit.cookies!.map((c) => [c.name, c.value, c.domain ?? c.url]),
    [
      [COOKIE, token, `.${k.host}`],
      [HOST_COOKIE, token, `https://${k.host}/`],
    ],
  )
  equal(did.slice(-2), ['find textarea', 'tap textarea'])
})

test('the platform owner may browse, and a window named is the one opened', async () => {
  let r = await browse(
    { ...manage, view: { width: 1280, height: 800, touch: false } },
    { cookie: owner.cookie },
  )
  equal(r.status, 200)
  equal(visits.at(-1)!.view, {
    width: 1280,
    height: 800,
    wait: 1000,
    touch: false,
  })
})

test('a person, a bearer and a page off our zone are each refused', async () => {
  let seen = visits.length
  equal((await browse(manage, { cookie: stranger.cookie })).status, 403)
  equal((await browse(manage, { authorization: 'Bearer x' })).status, 401)
  equal(
    (await browse({ url: 'https://example.com/' }, { cookie: checks.cookie }))
      .status,
    400,
  )
  equal(visits.length, seen)
})
