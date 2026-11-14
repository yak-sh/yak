import { equal, test } from '@yaks/testing'
import type { Ask } from '@yaks/esbuild'
import { strip } from '@yaks/esbuild/strip'
import { ADA, seeded } from './serving-data-probe.ts'
import { platform } from './deploy-probe.ts'
import { broadcast, drafted } from './page-notice.ts'
import { handler } from './kernel.ts'
import { tools as previews } from './preview-tools.ts'
import { type Ctx, TOOLS } from './tools.ts'
import type { Drafted } from './written.ts'
import type { Env } from './env.ts'

let fixture = async () => {
  let asks: Ask[] = []
  let sockets = new Map<string, { send(packet: string): void }[]>()
  let p = platform('a probe secret', {
    STORE: {
      idFromName: (name) => name,
      get: (name) => ({
        fetch: async (req: Request) => {
          let path = new URL(req.url).pathname
          if (path == '/drafted') {
            return drafted(req, (packet) => {
              broadcast(sockets.get(String(name)) ?? [], packet, (error) => {
                throw error
              })
            })
          }
          if (req.method == 'GET' && ['/vocab', '/uses'].includes(path)) {
            return Response.json({})
          }
          equal(req.method, 'POST')
          equal(req.headers.get('x-yak-kernel'), '1')
          let value = await req.json()
          if (path == '/expires') {
            equal(typeof value.at, 'number')
            if (!sockets.has(String(name))) sockets.set(String(name), [])
            return Response.json({ ok: true })
          }
          if (path == '/vocab') {
            equal(Object.keys(value.$defs ?? {}), [])
            return Response.json({
              comps: [],
              dropped: [],
              added: [],
              kept: [],
            })
          }
          if (['/uses', '/tools'].includes(path)) {
            return Response.json({ [path.slice(1)]: Object.keys(value) })
          }
          throw new Error(`Unhandled preview fixture: ${req.method} ${path}`)
        },
      }),
    },
    ESBUILD: {
      fetch: async (req: Request) => {
        let { ask } = await req.json() as { ask: Ask }
        asks.push(ask)
        return Response.json({
          pages: Object.fromEntries(ask.pages.map((p) => [p, 'export {}'])),
          assets: {},
          installed: [],
          notes: [],
          errors: [],
        })
      },
      strip,
    },
  } as Partial<Env>)
  let { dir } = await seeded(p.env, 'public', p.dir)
  let ctx: Ctx = { env: p.env, dir, person: ADA }
  let run = (name: string, args: Record<string, unknown>) =>
    TOOLS.find((t) => t.name == name)!.run(ctx, args)
  await run('app_new', { slug: 'entries', title: 'Entries' })
  await run('app_files', {
    app: 'entries',
    files: Object.entries({
      'index.html': '<script type="module" src="views.ts"></script>' +
        '<script type="module" src="main.ts"></script>',
      'views.ts': "import { title } from './parts/title.ts'; export { title }",
      'main.ts': "import { title } from './parts/shared.ts'; export { title }",
      'parts/title.ts': "export let title = 'Soup'",
      'parts/shared.ts': "export let title = 'Shared'",
      'unread.ts': 'export {}',
    }).map(([path, content]) => ({ path, content })),
  })
  let out = await previews[0].run(ctx, { app: 'entries', screenshot: false })
  let link = String(out.value!.url)
  let sent: { draft: Drafted }[] = []
  let name = [...sockets.keys()].find((n) =>
    n.includes(`preview/${out.value!.draft}`)
  )!
  sockets.get(name)!.push({
    send: (data: string) => void sent.push(JSON.parse(data)),
  })
  let write = (path: string, content: string) =>
    run('app_files', { app: 'entries', path, content })
  let request = (path: string) =>
    handler.fetch(new Request(new URL(path, link)), p.env)
  return { p, asks, sent, write, request }
}

let dependency = await fixture()
test('a draft write names the compiled page entry importing it without compiling until requested', async () => {
  let { asks, sent, write, request } = dependency
  await write('parts/title.ts', "export let title = 'Stew'")
  equal(
    sent.at(-1)!.draft.files.map(({ path, entries }) => ({ path, entries })),
    [
      { path: 'parts/title.ts', entries: ['views.ts'] },
    ],
  )
  equal(asks.length, 1)
  equal((await request('views.ts')).status, 200)
  equal(asks.at(-1)!.pages, ['views.ts'])
})

let skipped = await fixture()
test('a draft dependency write uses the last served plan when another write has not been requested', async () => {
  let { asks, sent, write } = skipped
  await write('unread.ts', 'export let unread = true')
  await write('parts/title.ts', "export let title = 'Stew'")
  equal(sent.at(-1)!.draft.files[0].entries, ['views.ts'])
  equal(asks.length, 1)
})

let changed = await fixture()
test('a draft notice follows the newest served import graph, naming every entry reached', async () => {
  let { sent, write, request } = changed
  await write(
    'main.ts',
    "import { title } from './parts/title.ts'; export { title }",
  )
  await request('main.ts')
  await write('parts/title.ts', "export let title = 'Stew'")
  equal(sent.at(-1)!.draft.files[0].entries, ['views.ts', 'main.ts'])
  await write('parts/shared.ts', "export let title = 'Old import'")
  equal(sent.at(-1)!.draft.files[0].entries, undefined)
})
