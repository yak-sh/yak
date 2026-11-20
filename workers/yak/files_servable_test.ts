import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { appStore, storeAt } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { filed } from './uploads.ts'
import * as files from './files.ts'
import { platform, seeded } from './serving-probe.ts'

// A public app holding a page of pictures, one of them deleted, and its
// store's reads counted: what the gateway asks before serving each.
let { env } = platform()
let { space, app } = await seeded(env)
let graph = metaOf(appStore(env.STORE, space, app, env))
let pictures = []
for (let n = 0; n < 12; n++) {
  let bytes = new TextEncoder().encode(`picture ${n}`)
  let file = await filed(env, space, app, graph, bytes, 'image/png', `${n}.png`)
  await graph.apply(file.bundles, KERNEL)
  pictures.push(file)
}
let [gone, ...kept] = pictures
await graph.apply(
  gone.bundles.filter((b) => !b.representation)
    .map((b) => ({ entity: b.entity, $delete: true })),
  KERNEL,
)

let reads = 0
let stores = env.STORE
env.STORE = {
  ...stores,
  get: (id: never) => {
    let store = stores.get(id)
    return {
      ...store,
      fetch: (req: Request) => {
        if (req.url.includes('representation')) reads++
        return store.fetch(req)
      },
    }
  },
} as Env['STORE']

let served = () =>
  Promise.all(pictures.map((f) =>
    files.servableOf(
      env,
      app,
      storeAt(space, app, env),
      f.sha,
      f.path.split('/')[1],
    )
  ))

test('a page of pictures asked at once costs its store one read, and one for those asked while it was out', async () => {
  let said = await served()
  assertEquals(
    [said.map((rep) => rep?.address ?? null), reads],
    [[null, ...kept.map((f) => f.sha)], 2],
  )
})
