// The deploy's compile step through app_deploy and the door that serves the
// app (esbuild.ts): what is asked of the compiler, what serves after, and what
// a refusal leaves standing. The compiler is yak-esbuild behind a binding,
// which runs only in workerd, so here it is a stand-in answering what the
// test says it compiled; @yaks/esbuild's own tests hold the plan.
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Answer, Ask } from '@yaks/esbuild'
import * as apps from './apps.ts'
import type { Env } from './env.ts'
import { ADA, platform, seeded, visit } from './serving-probe.ts'
import { call, type Ctx } from './tools.ts'

let WORKER = 'export default { fetch: () => new Response("compiled") }'

let PAGE = '<script type="module" src="main.ts"></script>'

// An app of these files deployed, with a compiler that answers `answer` and
// Cloudflare's API answering every upload.
let scenario = async (
  answer: (ask: Ask) => Partial<Answer> = () => ({}),
  compiler = true,
) => {
  let asks: Ask[] = []
  let ESBUILD = {
    fetch: async (r: Request) => {
      let ask = await r.json() as Ask
      asks.push(ask)
      return Response.json({
        pages: {},
        installed: [],
        notes: [],
        errors: [],
        ...answer(ask),
      })
    },
  }
  let p = platform({
    CF_ACCOUNT: 'acct',
    CF_WORKERS_TOKEN: 'a-token',
    ...(compiler ? { ESBUILD } : {}),
  } as Partial<Env>)
  let { dir } = await seeded(p.env)
  let ctx = { env: p.env, dir, person: ADA } as Ctx
  let tool = async (name: string, args: Record<string, unknown> = {}) =>
    (await call(ctx, name, { space: 'ada', app: 'cookbook', ...args })).text
  let write = (files: Record<string, string>) =>
    tool('app_files', {
      files: Object.entries(files).map(([path, content]) => ({
        path,
        content,
      })),
    })
  let uploads: FormData[] = []
  let was = globalThis.fetch
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    let r = new Request(input as string, init)
    if (new URL(r.url).hostname != 'api.cloudflare.com') return was(r)
    if (r.headers.get('content-type')?.startsWith('multipart/')) {
      uploads.push(await r.formData())
    }
    return Response.json({ success: true, errors: [], result: {} })
  }) as typeof fetch
  let served = async (path: string) => {
    let res = await apps.fetch(visit(`/cookbook/${path}`), p.env)
    return { type: res.headers.get('content-type'), body: await res.text() }
  }
  let seconds = async () => (await dir.space('ada'))!.meter?.seconds ?? 0
  return {
    asks,
    uploads,
    tool,
    write,
    served,
    seconds,
    [Symbol.dispose]: () => {
      globalThis.fetch = was
      p[Symbol.dispose]()
    },
  }
}

let compiles = (ask: Ask): Partial<Answer> => ({
  worker: ask.worker && { main: 'worker.js', code: WORKER },
  pages: Object.fromEntries(ask.pages.map((p) => [p, `/* ${p} */`])),
  lock: '{"lockfileVersion": 3}\n',
  installed: ['three@0.186.1'],
})

Deno.test('TypeScript and npm imports compile at deploy, and serve as JavaScript', async () => {
  using s = await scenario(compiles)
  await s.write({
    'index.html': PAGE,
    'main.ts': `import * as THREE from 'three'\nlet n: number = 1`,
    'worker.ts': `export default { fetch: (r: Request) => new Response('') }`,
    'package.json': '{"dependencies": {"three": "^0.186.0"}}',
  })
  let said = await s.tool('app_deploy')
  assert(said.includes('compiled worker.ts, main.ts'), said)
  assertEquals(s.asks.length, 1)
  assertEquals(s.asks[0].worker?.entry, 'worker.ts')
  assertEquals(s.asks[0].pages, ['main.ts'])
  // The page's script serves compiled, at its own address, as JavaScript,
  // while the file the agent wrote is still the one it reads back.
  assertEquals(await s.served('main.ts'), {
    type: 'text/javascript; charset=utf-8',
    body: '/* main.ts */',
  })
  assert((await s.tool('app_files', { op: 'read', path: 'main.ts' }))
    .includes('let n: number'))
  // The lock the compile left is an app file, so the version pins it.
  assertEquals(
    await s.tool('app_files', { op: 'read', path: 'package-lock.json' }),
    '{"lockfileVersion": 3}\n',
  )
  // The compiled module goes up in place of the source, under a JavaScript
  // name the platform's wrapper imports.
  let form = s.uploads.at(-1)!
  assertEquals(await (form.get('worker.js') as File).text(), WORKER)
  assert(!form.has('worker.ts'))
  assert((await (form.get('__yak_entry.js') as File).text())
    .includes(`from "./worker.js"`))
  // And the compile's time is on the space's meter.
  assert(await s.seconds() >= 1)
})

Deno.test('a compile that fails refuses the deploy, and the last release serves', async () => {
  let broken = false
  using s = await scenario((ask) =>
    broken
      ? { errors: ['main.ts:1:9: Expected ";" but found "number"'] }
      : compiles(ask)
  )
  await s.write({ 'index.html': PAGE, 'main.ts': 'let n: number = 1' })
  await s.tool('app_deploy')
  broken = true
  await s.write({ 'main.ts': 'let n number = 1' })
  await assertRejects(
    () => s.tool('app_deploy'),
    Error,
    'main.ts:1:9: Expected ";" but found "number"',
  )
  assertEquals((await s.served('main.ts')).body, '/* main.ts */')
})

Deno.test('a page that no longer needs compiling serves as written', async () => {
  using s = await scenario(compiles)
  await s.write({ 'index.html': PAGE, 'main.ts': 'let n: number = 1' })
  await s.tool('app_deploy')
  await s.write({ 'index.html': '<h1>no scripts</h1>' })
  await s.tool('app_deploy')
  assertEquals((await s.served('main.ts')).body, 'let n: number = 1')
})

Deno.test('an app with nothing to compile never calls the compiler', async () => {
  using s = await scenario(compiles)
  await s.write({
    'index.html': '<script type="module" src="app.js"></script>',
    'app.js': `import { apply } from './api/client.js'`,
    'worker.js': WORKER,
  })
  let said = await s.tool('app_deploy')
  assertEquals(s.asks, [])
  assert(!said.includes('compiled'), said)
  assertEquals(await s.seconds(), 0)
  assertEquals(
    await (s.uploads.at(-1)!.get('worker.js') as File).text(),
    WORKER,
  )
})

Deno.test('with no compiler bound, a deploy that needs one is refused in a sentence', async () => {
  using s = await scenario(compiles, false)
  await s.write({ 'worker.ts': 'export default {}' })
  await assertRejects(
    () => s.tool('app_deploy'),
    Error,
    'worker.ts must be compiled',
  )
})
