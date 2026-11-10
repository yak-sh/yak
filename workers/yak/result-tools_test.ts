import { equal, ok, test } from '@yaks/testing'
import type { Env } from './env.ts'
import type { Ctx } from './tool.ts'
import { operatorMemory } from './operator-testing.ts'
import { resultRequest } from './result-host.ts'
import { resultStore } from './result-tools.ts'

let stores = new Map<string, ReturnType<typeof operatorMemory>>()
let env = {
  BUILDER: {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (request: Request) => {
        equal(request.headers.get('x-yak-kernel'), '1')
        equal(request.headers.get('x-space-eid'), name)
        let store = stores.get(name) ?? operatorMemory()
        stores.set(name, store)
        let args = await request.json() as Record<string, unknown>
        return await resultRequest(
          store.g,
          new URL(request.url).pathname.slice('/result/'.length),
          args,
          String(args.reader),
        ) ?? new Response(null, { status: 404 })
      },
    }),
  },
} as unknown as Env
let space = { eid: crypto.randomUUID(), slug: 'checks' }
let app = { eid: crypto.randomUUID(), slug: 'sample', access: 'public' }
let privateApp = { ...app, access: 'private' }
let directory = {
  space: () => Promise.resolve(space),
  app: () => Promise.resolve(app),
  page: () => Promise.resolve({ space, role: 'viewer' }),
  role: () => Promise.resolve('viewer'),
  sitting: () => Promise.resolve(new Map([[space.eid, 'viewer']])),
}
let anonymous = { env, dir: directory, person: '' } as unknown as Ctx
let viewer = { ...anonymous, person: crypto.randomUUID() }
let source = { entity: { eid: crypto.randomUUID() } }
let data = {
  result: Array.from({ length: 100 }, (_, n) => ({ n, body: 'a'.repeat(500) })),
}
let publicStore = resultStore(anonymous, { space: space.slug, app: app.slug })
let publicResult = await publicStore.keep(data, source) as {
  id: string
  space: string
  app: string
}
let viewerStore = resultStore(viewer, { space: space.slug })
let viewerResult = await viewerStore.keep(data, source) as { id: string }
let catalogueStore = resultStore(anonymous)
let catalogue = await catalogueStore.keep(data, source) as {
  id: string
  scope: string
}
let home = { eid: crypto.randomUUID(), slug: 'home' }
let unscoped = {
  env,
  person: crypto.randomUUID(),
  dir: {
    ...directory,
    narrowedTo: () => Promise.resolve(null),
    own: () => Promise.resolve(home),
    seats: () =>
      Promise.resolve([{ space: home, role: 'owner' }, {
        space,
        role: 'owner',
      }]),
    page: (slug: string) =>
      Promise.resolve({
        space: slug == home.slug ? home : space,
        role: 'owner',
      }),
  },
} as unknown as Ctx
let unscopedStore = resultStore(unscoped)
let unscopedResult = await unscopedStore.keep(data, source) as {
  id: string
  space: string
}
let outsider = {
  ...anonymous,
  person: crypto.randomUUID(),
  dir: {
    ...directory,
    page: () => Promise.resolve({ space, role: null }),
    role: () => Promise.resolve(null),
  },
} as unknown as Ctx
let outsiderStore = resultStore(outsider, { space: space.slug, app: app.slug })
let outsiderResult = await outsiderStore.keep(data, source) as { id: string }

test('anonymous public results retain their app scope and can be narrowed', async () => {
  equal([publicResult.space, publicResult.app], ['checks', 'sample'])
  equal(await publicStore.query(publicResult.id, '.result[-1].n', source), {
    values: [99],
  })
  equal(await publicStore.read(publicResult.id), data)
})

test('a public app becoming private denies access to its kept results', async () => {
  let changed = {
    ...anonymous,
    dir: { ...directory, app: () => Promise.resolve(privateApp) },
  } as unknown as Ctx
  let error
  try {
    await resultStore(changed, { space: space.slug, app: app.slug }).read(
      publicResult.id,
    )
  } catch (e) {
    error = e
  }
  ok(error)
})

test('read-only space members can keep and query their own results', async () => {
  equal(await viewerStore.query(viewerResult.id, '.result | length', source), {
    values: [100],
  })
})

test('public directory snapshots have a catalogue scope independent of app results', async () => {
  equal(catalogue.scope, 'catalogue')
  equal(
    await resultStore(viewer, { scope: 'catalogue' }).query(
      catalogue.id,
      '.result | length',
      source,
    ),
    { values: [100] },
  )
  ok(stores.has('public-results'))
})

test('unscoped results use the caller home when they own multiple spaces', async () => {
  equal(unscopedResult.space, 'home')
  equal(
    await unscopedStore.query(unscopedResult.id, '.result | length', source),
    { values: [100] },
  )
})

test('signed-in nonmembers can retain and narrow public app results', async () => {
  equal(await outsiderStore.query(outsiderResult.id, '.result[-1].n', source), {
    values: [99],
  })
  let closed = {
    ...outsider,
    dir: { ...outsider.dir, app: () => Promise.resolve(privateApp) },
  } as unknown as Ctx
  let error
  try {
    await resultStore(closed, { space: space.slug, app: app.slug }).read(
      outsiderResult.id,
    )
  } catch (e) {
    error = e
  }
  ok(error)
})
