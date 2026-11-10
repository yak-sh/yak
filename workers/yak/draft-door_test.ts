import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import { platform } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import {
  ADA,
  ADA_OWNS,
  as,
  SECRET,
  seeded,
  visit,
} from './serving-data-probe.ts'
import { appStore, storeName } from './directory.ts'
import { GRANT, owning } from './dispatch.ts'
import { fetch } from './apps.ts'
import { KERNEL, metaOf } from './meta.ts'

let setup = async () => {
  let p = platform(SECRET)
  lifecycleStores(p.env)
  let { space, app } = await seeded(p.env, 'private', p.dir)
  let people = [mint(), mint()]
  await p.dir.apply({
    entities: [
      ...people.map((eid) => ({ entity: { eid }, person: {} })),
      { entity: { eid: app.eid }, app: { worker: 'worker.js' } },
    ],
  }, { ...ADA_OWNS, ...KERNEL })
  app = (await p.dir.app(space, app.slug))!
  // The private app's worker relays its STORE customer binding, as the
  // storefront does. Neither a cookie nor an app authority crosses this door.
  p.env.DISPATCH = {
    get: () => ({
      fetch: (request) =>
        fetch(
          visit('/cookbook/api/drafts', {
            method: request.method,
            headers: { [GRANT]: request.headers.get(GRANT)! },
            body: request.body,
          }),
          p.env,
        ),
    }),
  }
  let ask = (cookie?: string, init: RequestInit = {}, path = 'studio/drafts') =>
    fetch(
      visit('/cookbook/' + path, {
        ...init,
        headers: { ...cookie ? { cookie } : {}, ...init.headers },
      }),
      p.env,
    )
  let graph = metaOf(appStore(p.env.STORE, space, app, p.env), {
    ...KERNEL,
    'x-yak-person': app.eid,
    'x-yak-role': 'editor',
    'x-yak-administrative': '1',
  })
  return { p, people, space, app, ask, graph }
}
let json = async (response: Response) => {
  assertEquals(response.status, 200, await response.clone().text())
  assertEquals(response.headers.get('cache-control'), 'private, no-store')
  return response.json()
}
let write = (principal: string, text: string, extra = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    principal,
    place: 'book:prompt',
    text,
    over: '',
    ...extra,
  }),
})

test('private worker guest drafts use their vouched instrument and stay isolated from other browsers', async () => {
  let f = await setup()
  await using _p = f.p
  let first = await f.ask()
  let cookie = first.headers.get('set-cookie')!.split(';')[0]
  let snapshot = await json(first)
  let result = await json(
    await f.ask(
      cookie,
      write(snapshot.principal, 'Guest words', {
        by: ADA,
        via: f.people[0],
        $actor: { by: ADA },
      }),
    ),
  )
  let row = result.bundles.find((row: Bundle) => row.draft)
  assertEquals(row.draft.by, undefined)
  assertEquals(row.draft.via, snapshot.principal)
  assertEquals(row.created.by, undefined)
  assertEquals(row.created.via, snapshot.principal)
  assertEquals(
    (await json(await f.ask(cookie))).drafts[0].draft.text,
    'Guest words',
  )
  assertEquals((await json(await f.ask())).drafts, [])
  assertEquals(
    (await f.ask(cookie, write(f.people[0], 'Stolen identity'))).status,
    409,
  )
  assertEquals((await f.ask(cookie, {}, 'api/query?q=.draft')).status, 401)
  assertEquals((await f.graph.query('.draft')).length, 1)
})

test('private worker person drafts retain their person and never inherit app ownership', async () => {
  let f = await setup()
  await using _p = f.p
  let [a, b] = f.people, cookie = await as(a)
  let snapshot = await json(await f.ask(cookie))
  assertEquals(snapshot.principal, a)
  let result = await json(await f.ask(cookie, write(a, 'Person words')))
  let row = result.bundles.find((row: Bundle) => row.draft)
  assertEquals(row.draft.by, a)
  assertEquals(row.draft.via, undefined)
  assertEquals(row.created.by, a)
  assert(row.created.via)
  assertEquals((await json(await f.ask(await as(b)))).drafts, [])
  assertEquals((await json(await f.ask(await as(ADA)))).drafts, [])
  assertEquals((await f.ask(cookie, {}, 'api/query?q=.draft')).status, 403)
  let refused = await f.ask(await as(ADA), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{
      entity: row.entity,
      draft: { text: 'Owner overwrite' },
    }]),
  }, 'api/apply')
  assertEquals(refused.status, 403)
  assertEquals(
    (await f.ask(undefined, {
      headers: {
        [GRANT]: await owning(SECRET, storeName(f.space, f.app), f.app),
      },
    }, 'api/drafts')).status,
    403,
  )
  assertEquals(
    ((await f.graph.query('.draft'))[0].draft as Comp).text,
    'Person words',
  )
})
