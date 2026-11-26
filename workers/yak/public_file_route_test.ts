// A public app's files as a crawler walks them (T-3848): the route a read
// that names nobody asks is answered by the serving copy while no write's
// fence is up, Site keeps a worker app's release bytes, and an app that
// declares its worker's routes answers an address it never made with a 404.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { KEEP } from '@yaks/platform/kept'
import {
  ServingCopy,
  type ServingCopyState,
  ServingCopyUnavailable,
} from '@yaks/platform/serving-copy'
import type { ServingCopyDoor } from './directory-copy.ts'
import * as dirPart from './directory.ts'
import { edged } from './apps.ts'
import type { Env } from './env.ts'
import { connector, fresh } from './probe.ts'

// Production's serving copy behind its RPC door, `read` included.
let copy = (): ServingCopyDoor => {
  let saved: ServingCopyState | undefined
  let core = new ServingCopy({
    persistence: { read: () => saved, write: (next) => void (saved = next) },
  })
  let unavailable = <T>(read: () => T) => {
    try {
      return Promise.resolve(read())
    } catch (e) {
      if (e instanceof ServingCopyUnavailable) return Promise.resolve(null)
      throw e
    }
  }
  return {
    begin: (floor) => Promise.resolve(core.begin(floor)),
    finish: (revision) => Promise.resolve(core.finish(revision)),
    revision: () => Promise.resolve(core.revision),
    settle: (revision, committed) =>
      Promise.resolve(core.settle(revision, committed)),
    put: (...args) => Promise.resolve(core.put(...args)),
    get: (key) => Promise.resolve().then(() => core.get(key)),
    read: (key) => unavailable(() => core.read(key)),
    valid: (revision) => Promise.resolve(core.valid(revision)),
    publish: (...args) => Promise.resolve(core.publish(...args)),
  }
}

// Every app's worker, as openai-math's answers: its problem pages,
// `p/<number>`, and a 404 that passes the rest to the files. `asked` is each
// path it was asked about.
let asked: string[] = []
let DISPATCH = {
  get: () => ({
    fetch: (req: Request) => {
      let path = new URL(req.url).pathname
      asked.push(path)
      return Promise.resolve(
        /\/p\/\d+$/.test(path)
          ? new Response('from the worker')
          : new Response(null, { status: 404 }),
      )
    },
  }),
}
let env!: Env
let door = copy()
let k = await fresh(
  { SERVING_COPY: { idFromName: (name) => name, get: () => door }, DISPATCH },
  (e) => env = e,
)
// Every line a request asks the directory for the app's route.
let routes: string[] = []
env.DIRECTORY = {
  fetch: (req: Request) => {
    let url = new URL(req.url)
    let lines = url.pathname == '/query'
      ? [url.searchParams.get('q') ?? '']
      : url.pathname == '/reads'
      ? url.searchParams.getAll('q')
      : []
    routes.push(...lines.filter((q) => q.includes('.app.slug=')))
    return dirPart.fetch(req, env)
  },
}
let agent = connector(k, k.owner.cookie)
let host = `owner.${k.host}`
let release = async (
  app: string,
  files: { path: string; content: string }[],
) => {
  await agent.tool('app_new', {
    space: 'owner',
    slug: app,
    title: app,
    access: 'public',
  })
  await agent.tool('app_files', {
    space: 'owner',
    app,
    files: [{ path: 'index.html', content: `<h1>${app}</h1>` }, ...files],
  })
  await agent.tool('app_deploy', { space: 'owner', app })
  await k.settled()
}
let get = (path: string) => k.at(host, path)
let text = async (path: string) => {
  let r = await get(path)
  return [r.status, await r.text()] as const
}
// What Site's fill makes of an address: kept for every visitor, or passed.
let keeps = async (path: string) => {
  let r = await edged(new Request(`https://${host}${path}`), env)
  await r.body?.cancel()
  return r.headers.has(KEEP)
}
// The server source a release needs to build a worker at all; the namespace
// above runs in its place.
let WORKER =
  'export default { fetch: () => new Response(null, { status: 404 }) }'

await release('math', [{ path: 'data.json', content: '{"n":1}' }])
await release('walked', [{ path: 'worker.js', content: WORKER }])
await release('routed', [
  { path: 'data.json', content: '{"n":2}' },
  { path: 'worker.js', content: WORKER },
  {
    path: 'wrangler.jsonc',
    content: '{"assets": {"run_worker_first": ["/p/*", "!/p/a.css"]}}',
  },
])

test("a stranger's file reads ask the directory once, until a write's fence", async () => {
  routes.length = 0
  let first = await text('/math/data.json')
  await k.settled()
  let cold = routes.length
  routes.length = 0
  let again = await Promise.all(
    ['/math/data.json', '/math/', '/math/data.json'].map(get),
  )
  for (let r of again) await r.body?.cancel()
  let copied = routes.length
  await agent.tool('app_set', {
    space: 'owner',
    app: 'math',
    access: 'private',
  })
  let after = await get('/math/data.json')
  await after.body?.cancel()
  assertEquals(first, [200, '{"n":1}'])
  assert(cold > 0)
  assertEquals(again.map((r) => r.status), [200, 200, 200])
  assertEquals(copied, 0)
  // Private now: the copy's line from before the write never answers.
  assert(after.status >= 300, `a private app answered ${after.status}`)
})

test("Site keeps a worker app's release bytes, and not its pages", async () => {
  assert(await keeps('/walked/api/client.js'))
  assert(!await keeps('/walked/'))
})

test("an app that declares its worker's routes leaves every other path to its files", async () => {
  asked.length = 0
  assertEquals(await text('/routed/p/1'), [200, 'from the worker'])
  assertEquals(await text('/routed/data.json'), [200, '{"n":2}'])
  assertEquals(asked.map((p) => p.replace(/^.*\/routed/, '')), ['/p/1'])
  assert(await keeps('/routed/data.json'))
  assert(!await keeps('/routed/p/1'))
})

test('a page no declared route names is a 404, not the app', async () => {
  // One the worker passed, and one it is never asked about.
  let passed = await text('/routed/p/admin/problems/admin/submit/')
  let unasked = await text('/routed/admin/problems/videos/')
  let undeclared = await text('/walked/problems/admin/submit/')
  for (let [status, body] of [passed, unasked]) {
    assertEquals(status, 404)
    assert(!body.includes('<h1>routed</h1>'))
  }
  // Without a declaration a route still opens the app's page.
  assertEquals(undeclared[0], 200)
  assertStringIncludes(undeclared[1], '<h1>walked</h1>')
})
