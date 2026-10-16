/// <reference lib="deno.ns" />
// Durable multi-store replay across real Store objects and an eviction.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, token } from '@yaks/graph'
import { Store } from './graph.ts'
import { type App, appStore, type Space, storeName } from './directory.ts'
import { bucket, durable } from './testing.ts'
import { vouched, type Who } from './session.ts'
import { type Reach, read, written } from './reach.ts'
import type { Env } from './env.ts'
import { keepDeclaration } from './declaration.ts'
let space = (slug: string): Space => ({
  eid: `space-${slug}`,
  slug,
  title: slug,
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
})

let app = (slug: string, spaceEid: string): App => ({
  eid: `app-${slug}`,
  slug,
  space: spaceEid,
  version: 1,
  title: slug,
  access: 'private',
  store: null,
  slugs: [slug],
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  gallery: null,
  screenshot: null,
  seeded: null,
  trashed: null,
  theme: null,
})

let ADA = 'b0000000-0000-4000-8000-000000000002'
let owner: Who = { person: ADA, role: 'owner' }

// The kernel's own namespace, made of Store objects: one per name, kept, so a
// second call reaches the object the first one wrote to. What the store is
// told about itself — which app it holds, what its access mode is — rides on
// each request already (directory.ts `appStore`). `recover` drops every object
// and keeps its storage, so the next call wakes a new incarnation over it.
let namespace = () => {
  let held = new Map<string, Store>()
  let kept = new Map<string, ReturnType<typeof durable>>()
  let failing = '', waiting: Promise<void> = Promise.resolve()
  let committed = () => {}
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: async (req: Request) => {
        let name = String(id), url = new URL(req.url)
        let applying = url.pathname == '/apply' &&
          !url.searchParams.has('check')
        if (applying && name == failing) {
          await waiting
          return new Response('store unavailable', { status: 503 })
        }
        let store = held.get(name)
        if (!store) {
          let storage = kept.get(name) ?? durable(name)
          kept.set(name, storage)
          store = new Store({
            storage,
            acceptWebSocket: () => {},
            getWebSockets: () => [],
          })
          held.set(name, store)
        }
        let res = await store.fetch(req)
        if (applying && res.status == 200) committed()
        return res
      },
    }),
    failAfterFirst: (name: string) => {
      failing = name
      waiting = new Promise<void>((resolve) => committed = resolve)
    },
    recover: () => {
      failing = ''
      held.clear()
    },
  }
}

// One app deployed into its own store: the manifest, planted the way
// `app_deploy` plants it, through the same door with the same vouch.
let deploy = async (env: Env, r: Reach, manifest: Record<string, unknown>) => {
  let res = await appStore(env.STORE, r.space, r.app)('/vocab', {
    method: 'POST',
    body: JSON.stringify(manifest),
  }, vouched(r.who))
  assertEquals(res.status, 200)
  await res.body?.cancel()
  // Deployment commits its accepted release declaration before discovery
  // selects it. Reading the accepted document here also keeps borrowed words
  // and translations identical to the Store used by these reach assertions.
  if (env.BLOBS) {
    let vocab = await (await appStore(env.STORE, r.space, r.app)('/vocab'))
      .json()
    await keepDeclaration(env, r.space, r.app, String(r.app.version), {
      vocab,
      tools: {},
    })
  }
}

let ns = namespace()
let env = { STORE: ns, BLOBS: bucket().r2 } as unknown as Env
let here = space('multi-outbox')
let reach: Reach[] = ['left', 'right'].map((slug) => ({
  space: here,
  app: app(slug, here.eid),
  who: owner,
}))
for (let r of reach) {
  await deploy(env, r, {
    $defs: {
      [r.app.slug]: {
        component: true,
        properties: { body: { type: 'string' } },
      },
    },
  })
}
let target = crypto.randomUUID()
await written(env, reach, undefined, [{
  entity: { eid: target },
  left: { body: 'before' },
  right: { body: 'before' },
}])
let payload: Bundle[] = [{
  entity: { eid: target },
  left: { body: 'after' },
  right: { body: 'after' },
  $was: { left: { body: token('before') }, right: { body: token('before') } },
}, {
  entity: { eid: '$new' },
  left: { body: 'new' },
  right: { body: 'new' },
  $was: { left: { body: null }, right: { body: null } },
}]
let headers = { 'idempotency-key': 'outbox:multi-partial' }
// Leave the first store committed, with no acceptance reaching the caller;
// the second store has only rehearsed. Then evict both objects.
ns.failAfterFirst(storeName(here, reach[1].app))
await assertRejects(() => written(env, reach, undefined, payload, headers))
ns.recover()

// Set up each observed behavior outside its timing window.
let accepted = await written(env, reach, undefined, payload, headers)
let rows = await read(env, reach, '.left&?right') as Bundle[]
let rehearsal = await written(env, reach, undefined, payload, headers, true)
let duplicate = await written(env, reach, undefined, payload, headers)

test('partial multi-store outbox replay accepts original guards and one alias after eviction', () => {
  assertEquals(rows.length, 2)
  assertEquals(rows.find((b) => b.entity.eid == target)?.left, {
    body: 'after',
  })
  let fresh = rows.find((b) => b.entity.eid == accepted.aliases.$new)!
  assertEquals(fresh.left, { body: 'new' })
  assertEquals(fresh.right, { body: 'new' })
  assertEquals(rehearsal, accepted)
  assertEquals(duplicate, accepted)
})

let changed = structuredClone(payload)
changed[0].right = { body: 'different' }
let mismatch = await written(env, reach, undefined, changed, headers, true)
  .then(() => 'accepted', (e) => String(e))
let mismatchedCommit = await written(env, reach, undefined, changed, headers)
  .then(() => 'accepted', (e) => String(e))
test('durable receipt refuses a changed spanning intent during rehearsal and commit', () => {
  assertEquals(mismatch.includes('different intent'), true)
  assertEquals(mismatchedCommit.includes('different intent'), true)
})

let left = appStore(env.STORE, here, reach[0].app)
let replay = async (who: Who) => {
  let res = await left('/apply?check=1', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, { ...vouched(who), ...headers })
  let status = res.status
  await res.body?.cancel()
  return status
}
let signedOut = await replay({ person: null, role: null } as unknown as Who)
let viewer = await replay({ ...owner, role: 'viewer' })
test('durable receipt checks current authority before returning any cached acceptance', () => {
  assertEquals(signedOut, 401)
  assertEquals(viewer, 403)
})
