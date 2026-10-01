import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { type Directory, directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { type Door, type Namespace } from './door.ts'
import type { Env } from './env.ts'
import { platform } from './testing.ts'
import { call, type Ctx, releaseNotice } from './tools.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let fixture = async (env: Env) => {
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ctx: Ctx = { env, dir, person: ADA }
  await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'recipes', title: 'R' })
  await call(ctx, 'app_list', {})
  let args = { space: 'ada', app: 'recipes' }
  let write = (text: string) =>
    call(ctx, 'app_files', {
      ...args,
      path: 'index.html',
      content: `<h1>${text}</h1>`,
    })
  let history = async () => {
    let space = (await dir.space('ada'))!
    return dir.deploys((await dir.app(space, 'recipes'))!)
  }
  return { ctx, dir, args, write, history }
}

test('deploy reload marks survive recording, rollback is required, and notices follow the commit', async () => {
  using scenario = platform('reload-secret')
  let { env } = scenario
  let store = env.STORE as unknown as Namespace
  let versions: number[] = []
  let committed: unknown[] = []
  let f: Awaited<ReturnType<typeof fixture>>
  let STORE: Namespace = {
    idFromName: (name) => store.idFromName(name),
    get: (id) => ({
      fetch: async (req) => {
        if (new URL(req.url).pathname == '/released') {
          let { version } = await req.clone().json()
          // Both the app pointer and deploy row must already be committed.
          let rows = await f.history()
          let space = (await f.dir.space('ada'))!
          committed.push([
            req.method,
            req.headers.get('x-yak-kernel'),
            rows[0]?.version,
            (await f.dir.app(space, 'recipes'))!.version,
          ])
          versions.push(version)
        }
        return store.get(id).fetch(req)
      },
    }),
  }
  f = await fixture({ ...env, STORE } as Env)
  await f.write('one')
  await call(f.ctx, 'app_deploy', f.args)
  await f.write('two')
  await call(f.ctx, 'app_deploy', { ...f.args, reload: 'optional' })
  await f.write('three')
  await call(f.ctx, 'app_deploy', { ...f.args, reload: 'required' })
  await call(f.ctx, 'app_rollback', { ...f.args, version: 2 })
  assertEquals((await f.history()).map((v) => v.reload), [
    'required',
    'required',
    null,
    null,
  ])
  assertEquals(committed, [1, 2, 3, 4].map((v) => ['POST', '1', v, v]))
  assertEquals(versions, [1, 2, 3, 4])
  await assertRejects(() =>
    call(f.ctx, 'app_deploy', {
      ...f.args,
      reload: 'never',
    })
  )
  assertEquals(versions, [1, 2, 3, 4])

  await f.write('failed')
  let blocked = new Proxy(f.dir, {
    get: (dir, key) => {
      if (key == 'stamp') {
        return (m: Parameters<Directory['stamp']>[0]) => {
          if (m.entities.some((e) => e.deploy)) {
            throw new Error('record refused')
          }
          return dir.stamp(m)
        }
      }
      return Reflect.get(dir, key)
    },
  }) as Directory
  await assertRejects(
    () => call({ ...f.ctx, dir: blocked }, 'app_deploy', f.args),
    Error,
    'record refused',
  )
  assertEquals(versions, [1, 2, 3, 4])
  assertEquals((await f.history())[0].version, 4)
})

for (let mode of ['network', 'non-ok']) {
  test(`a ${mode} release notice cannot fail a committed deploy`, async () => {
    using scenario = platform('reload-secret')
    let store = scenario.env.STORE as unknown as Namespace
    let notices = 0
    let STORE: Namespace = {
      idFromName: (name) => store.idFromName(name),
      get: (id) => ({
        fetch: (req) => {
          if (new URL(req.url).pathname == '/released') {
            notices++
            if (mode == 'network') throw new Error('offline')
            return Promise.resolve(new Response('unavailable', { status: 503 }))
          }
          return store.get(id).fetch(req)
        },
      }),
    }
    let f = await fixture({ ...scenario.env, STORE } as Env)
    await f.write('one')
    await call(f.ctx, 'app_deploy', { ...f.args, reload: 'required' })
    assertEquals(notices, 1)
    assertEquals((await f.history()).map((v) => [v.version, v.reload]), [
      [1, 'required'],
    ])
  })
}

test('even a throwing release-notice reporter cannot fail the release', async () => {
  let reported = 0
  let store = Object.assign(() => Promise.reject(new Error('offline')), {
    consume: () => Promise.reject(new Error('offline')),
  }) as Door
  await releaseNotice(store, 7, {}, () => {
    reported++
    throw new Error('Sentry unavailable')
  })
  assertEquals(reported, 1)
})

test('updates carry every crossed required source mark but exclude the installed and later releases', async () => {
  using scenario = platform('reload-secret')
  let f = await fixture(scenario.env)
  let deploy = async (n: number, reload?: string) => {
    await f.write(String(n))
    await call(f.ctx, 'app_deploy', { ...f.args, ...reload ? { reload } : {} })
  }
  let publish = () =>
    call(f.ctx, 'app_publish', {
      ...f.args,
      name: 'reload-recipes',
      about: 'Recipes',
    })
  await deploy(1, 'required')
  await publish()
  await call(f.ctx, 'space_new', { slug: 'bo', title: 'Bo' })
  await call(f.ctx, 'app_install', { space: 'bo', name: 'reload-recipes' })
  let installed = async () => {
    let space = (await f.dir.space('bo'))!
    return f.dir.deploys((await f.dir.app(space, 'recipes'))!)
  }
  let update = () => call(f.ctx, 'app_update', { space: 'bo', app: 'recipes' })
  await deploy(2)
  await publish()
  await update()
  assertEquals((await installed())[0].reload, null)
  await deploy(3, 'required')
  await deploy(4, 'optional')
  await publish()
  await deploy(5, 'required') // not offered: outside the crossed interval
  await update()
  assertEquals((await installed())[0].reload, 'required')
  // Remove only the intermediate mark: neither the old pin nor unoffered v5
  // can supply required when the installed pin crosses the same interval again.
  let source = await f.history()
  await f.dir.apply({
    entities: [
      {
        entity: { eid: source.find((v) => v.version == 3)!.eid },
        deploy: { reload: null },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  let space = (await f.dir.space('bo'))!
  let app = (await f.dir.app(space, 'recipes'))!
  await f.dir.apply({
    entities: [
      { entity: { eid: app.eid }, installed: { version: 2 } },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  await update()
  assertEquals((await installed())[0].reload, null)
})
