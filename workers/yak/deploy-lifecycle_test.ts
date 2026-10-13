import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { appStore, type Directory, directory, storeName } from './directory.ts'
import * as dirPart from './directory.ts'
import { type Door, type Namespace } from './door.ts'
import type { Env } from './env.ts'
import { ran, workerBreak } from './dispatch.ts'
import { declared, keep, platform } from './testing.ts'
import { call, type Ctx, releaseNotice } from './tools.ts'
import * as apps from './apps.ts'
import { r2Objects } from './lib/objects.ts'
import { pins, sha256 } from './versions.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let fixture = async (env: Env) => {
  let dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  let ctx: Ctx = { env, dir, person: ADA }
  await call(ctx, 'space_new', { slug: 'ada', title: 'Ada' })
  await call(ctx, 'app_new', { space: 'ada', slug: 'recipes', title: 'R' })
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

test('deploy reload marks survive recording, and pointer notices follow the commit', async () => {
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
    null,
    null,
  ])
  assertEquals(
    committed,
    [[1, 1], [2, 2], [3, 3], [3, 2]].map((
      [newest, live],
    ) => ['POST', '1', newest, live]),
  )
  assertEquals(versions, [1, 2, 3, 2])
  await assertRejects(() =>
    call(f.ctx, 'app_deploy', {
      ...f.args,
      reload: 'never',
    })
  )
  assertEquals(versions, [1, 2, 3, 2])

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
  assertEquals(versions, [1, 2, 3, 2])
  assertEquals((await f.history())[0].version, 3)
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
    throw new Error('the tracker unavailable')
  })
  assertEquals(reported, 1)
})

test('updates carry every crossed required source mark but exclude the installed and later releases', async () => {
  using scenario = platform('reload-secret')
  let f = await fixture(scenario.env)
  // The source accepted this vocabulary before the platform reserved cost.
  // Seed its stored declaration; every release below keeps its own bytes.
  let words = JSON.stringify({
    $defs: { cost: { properties: { euros: { type: 'number' } } } },
  })
  let home = (await f.dir.space('ada'))!
  let original = (await f.dir.app(home, 'recipes'))!
  let name = storeName(home, original)
  scenario.object(name)
  keep(scenario.states.get(name)!, 'vocab', words)
  let blobs = r2Objects(scenario.env.BLOBS)
  let files: Record<string, string> = {}
  for (
    let [path, text] of Object.entries({
      'index.html': '<h1>1</h1>',
      'vocab.json': words,
    })
  ) {
    let bytes = new TextEncoder().encode(text)
    files[path] = await sha256(bytes)
    await pins(blobs, 'ada/recipes/').put(files[path], bytes)
    await blobs.put(`ada/recipes/${path}`, bytes)
  }
  await f.dir.apply({
    entities: [
      { entity: { eid: original.eid }, app: { version: 1 } },
      {
        entity: { eid: crypto.randomUUID() },
        deploy: {
          app: original.eid,
          version: 1,
          files: JSON.stringify(files),
          worker: '',
          reload: 'required',
        },
      },
    ],
  })
  await declared(scenario.env, home, (await f.dir.app(home, 'recipes'))!, {
    vocab: JSON.parse(words),
    tools: {},
  })
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
  let copy = { space: 'bo', app: 'recipes' }
  let remove = async () => {
    await call(f.ctx, 'app_files', {
      ...copy,
      path: 'vocab.json',
      content: '{}',
    })
    await call(f.ctx, 'app_deploy', copy)
  }
  await remove()
  await update()
  assertEquals((await installed())[0].reload, null)
  // Removing an empty word and restoring the kept release must admit that
  // release's declaration again, without changing any version or file.
  let before = await installed()
  await remove()
  await call(f.ctx, 'app_rollback', { ...copy, version: 1 })
  assertEquals((await installed()).slice(1), before)
  assertEquals(
    (await call(f.ctx, 'app_files', {
      ...copy,
      op: 'read',
      path: 'vocab.json',
    })).text,
    words,
  )
  let store = appStore(
    scenario.env.STORE,
    space,
    (await f.dir.app(space, 'recipes'))!,
  )
  let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
  let wrote = await store('/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid: crypto.randomUUID() },
      cost: { euros: 12 },
    }]),
  }, by)
  assertEquals(wrote.status, 200, await wrote.text())
  let read = await store('/query?q=.cost.euros=12', {}, by)
  assertEquals((await read.json())[0].cost, { euros: 12 })
})

test('rollback selects kept bytes without minting or changing deploys, then deploy allocates above history', async () => {
  using scenario = platform('rollback-secret')
  let f = await fixture(scenario.env)
  await f.write('one')
  await call(f.ctx, 'app_deploy', f.args)
  await f.write('two')
  await call(f.ctx, 'app_files', {
    ...f.args,
    path: 'main.js',
    content: "import './missing.js'",
  })
  await call(f.ctx, 'app_deploy', f.args)
  let before = await f.history()
  let notices: unknown[] = []
  let wire = scenario.env.WIRE as unknown as Namespace
  let env = {
    ...scenario.env,
    WIRE: {
      idFromName: (name: string) => wire.idFromName(name),
      get: (id: Parameters<Namespace['get']>[0]) => ({
        fetch: async (req: Request) => {
          if (new URL(req.url).pathname == '/tell') {
            notices.push(await req.clone().json())
          }
          return wire.get(id).fetch(req)
        },
      }),
    },
  } as Env
  let report = async (
    version: number | null,
    src: string,
    message = `failed to load script ${src}`,
  ) => {
    let res = await apps.fetch(
      new Request('https://ada.yaks.app/recipes/api/report', {
        method: 'POST',
        body: JSON.stringify({ version, url: src, message }),
      }),
      env,
    )
    assertEquals(res.status, 204)
    await res.body?.cancel()
  }
  let src = 'https://ada.yaks.app/recipes/main.js'
  for (
    let [version, address, message] of [
      [1, src],
      [null, src],
      [2, 'https://elsewhere.test/recipes/main.js'],
      [2, 'https://ada.yaks.app/another/main.js'],
      [2, 'https://ada.yaks.app/recipes/api/client.js'],
      [2, src, 'x is not a function'],
    ] as [number | null, string, string?][]
  ) {
    await report(version, address, message)
  }
  let space = (await f.dir.space('ada'))!
  assertEquals((await f.dir.app(space, 'recipes'))!.version, 2)
  let releaseId = before[0].source!.split('/').at(-1)
  await report(
    2,
    `https://ada.yaks.app/recipes/api/assets/${releaseId}/main.js`,
  )
  assertEquals((await f.dir.app(space, 'recipes'))!.version, 1)
  assertEquals(await f.history(), before)
  assertEquals(
    notices.some((n) =>
      JSON.stringify(n).includes('automatically rolled back v2 to v1')
    ),
    true,
  )
  // Repeated reports from the old page do not move the pointer again.
  await report(2, src)
  assertEquals((await f.dir.app(space, 'recipes'))!.version, 1)
  await call(f.ctx, 'app_rollback', { ...f.args, version: 2 })
  await call(f.ctx, 'app_rollback', f.args)
  assertEquals(await f.history(), before)
  assertEquals((await f.dir.app(space, 'recipes'))!.version, 1)
  let list = (await call(f.ctx, 'app_versions', f.args)).text
  assertEquals(list.includes('v1 (live)'), true)
  assertEquals(list.includes('moved v2 → v1'), true)
  assertEquals(list.includes(`by ${ADA}`), true)
  assertEquals(list.includes('[object Object]'), false)
  await call(f.ctx, 'app_rollback', { ...f.args, version: 2 })
  assertEquals(await f.history(), before)
  await call(f.ctx, 'app_rollback', { ...f.args, version: 1 })
  await f.write('three')
  await call(f.ctx, 'app_files', {
    ...f.args,
    path: 'main.js',
    content: "import './missing.js'",
  })
  await call(f.ctx, 'app_deploy', f.args)
  assertEquals((await f.history()).map((v) => v.version), [3, 2, 1])
  assertEquals((await f.history()).slice(1), before)
  // The preceding live version was v1, even though v2 is the prior deploy.
  await report(3, src)
  assertEquals((await f.dir.app(space, 'recipes'))!.version, 1)
})

test('worker errors after rollback and an in-flight pointer move name the routed bytes', async () => {
  using scenario = platform('rollback-errors')
  let f = await fixture(scenario.env)
  await f.write('one')
  await call(f.ctx, 'app_deploy', f.args)
  await f.write('two')
  await call(f.ctx, 'app_deploy', f.args)
  await call(f.ctx, 'app_rollback', { ...f.args, version: 1 })
  let space = (await f.dir.space('ada'))!
  let app = (await f.dir.app(space, 'recipes'))!
  let env: Env = {
    ...scenario.env,
    DISPATCH: {
      get: () => ({
        fetch: async () => {
          await call(f.ctx, 'app_rollback', { ...f.args, version: 2 })
          return new Response('version one failed', { status: 500 })
        },
      }),
    },
  }
  let visitor = new Request('https://ada.yaks.app/recipes/')
  await workerBreak(
    scenario.env,
    space,
    { ...app, version: 2 },
    visitor,
    new Error('version two failed'),
  )
  await call(f.ctx, 'app_rollback', { ...f.args, version: 1 })
  let current = (await call(f.ctx, 'app_errors', f.args)).text
  assertEquals(current, 'no open errors')
  await workerBreak(
    scenario.env,
    space,
    app,
    visitor,
    new Error('version one failed'),
  )
  current = (await call(f.ctx, 'app_errors', f.args)).text
  assertEquals(current.includes('v1'), true, current)
  await call(f.ctx, 'app_errors', { ...f.args, seen: ['all'] })
  await ran(env, space, app, new Request('https://ada.yaks.app/recipes/'), {
    person: ADA,
    role: 'owner',
  })
  let errors = (await call(f.ctx, 'app_errors', { ...f.args })).text
  assertEquals(errors.includes('v1'), true, errors)
  assertEquals(errors.includes('v2'), false, errors)
})

test('legacy source-less rollback keeps deploy rows unchanged and remains undoable', async () => {
  using scenario = platform('rollback-legacy')
  let f = await fixture(scenario.env)
  await f.write('one')
  await call(f.ctx, 'app_deploy', f.args)
  await f.write('two')
  await call(f.ctx, 'app_deploy', f.args)
  let all = await f.history()
  await f.dir.stamp({
    entities: [{
      entity: { eid: all[1].eid },
      deploy: { source: null, script: null },
    }],
  })
  let before = await f.history()
  await call(f.ctx, 'app_rollback', { ...f.args, version: 1 })
  assertEquals(await f.history(), before)
  await call(f.ctx, 'app_rollback', { ...f.args, version: 2 })
  assertEquals(await f.history(), before)
  await f.write('three')
  await call(f.ctx, 'app_deploy', f.args)
  assertEquals((await f.history()).slice(1), before)
})
