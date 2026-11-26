import { parseHTML } from 'linkedom'
import { line, whole } from '@yaks/query'
import { assert, assertEquals as equal } from '@std/assert'
import { test } from '@yaks/testing'
import { type Comp, mint } from '@yaks/graph'
import { parseTools } from '@yaks/tools/declared'
import { publishService } from '@yaks/connections'
import { platform } from './testing.ts'
import { ADA, as, SECRET } from './serving-data-probe.ts'
import { fetch as appFetch } from './apps.ts'
import { serviceConsent } from './service-consent.ts'
import { appStore, directoryOf, releaseOf } from './directory.ts'
import { keepDeclaration } from './declaration.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { serviceFrom, verifyService } from './service-call.ts'

test('internal graph reads retain canonical references while public named reads retain their privacy', async () => {
  await using p = platform(SECRET)
  let { env } = p
  let dir = directoryOf(env.STORE)
  let slug = 'refs'
  let person = ADA, stranger = mint()
  let name = 'Named service customer'
  let space = mint(), consumer = mint(), merchant = mint(), notebook = mint()
  await dir.stamp({
    entities: [
      { entity: { eid: person }, person: {}, doc: { title: name } },
      { entity: { eid: stranger }, person: {} },
      { entity: { eid: space }, space: { slug, store: slug } },
      {
        entity: { eid: '$seat' },
        member: { space, person, role: 'owner' },
      },
      ...[['consumer', consumer], ['merchant', merchant]].map((
        [slug, eid],
      ) => ({
        entity: { eid },
        app: {
          space,
          slug,
          access: 'private',
          version: 1,
          worker: 'worker.js',
        },
      })),
      {
        entity: { eid: notebook },
        app: { space, slug: 'notes', access: 'public', version: 1 },
      },
    ],
  })
  let cookie = await as(person)
  let at = (path: string, init?: RequestInit) =>
    appFetch(new Request(`https://${slug}.yaks.app${path}`, init), env)
  let connect = (url: string, init?: RequestInit) =>
    serviceConsent(new Request(new URL(url, 'https://yaks.app'), init), env)
  let graph = meta(env), read = (q: unknown) => graph.query(whole(String(q)))
  let [trusted] = await graph.query(line`.entity.eid=${person}`, {
    trusted: true,
  })
  equal(trusted.entity.eid, person)
  let source = await dir.appAt(consumer)
  let seller = await dir.appAt(merchant)
  assert(source && seller)
  await keepDeclaration(
    env,
    seller.space,
    seller.app,
    releaseOf(seller.app),
    {
      vocab: {},
      tools: parseTools({
        $defs: {
          quote: {
            tool: true,
            floor: 'person',
            description: 'Fixture quote',
            worker: '/quote',
            service: { pricing: 'Fixture only' },
          },
        },
      }, []),
    },
  )
  await graph.apply(
    await publishService(read, {
      app: seller.app.eid,
      owner: seller.space.eid,
      listed: false,
    }),
    KERNEL,
  )
  let response = await at(
    '/consumer/api/service/connect',
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        service: seller.app.eid,
        operations: ['quote'],
      }),
    },
  )
  equal(response.status, 200, await response.clone().text())
  let pending = await response.json()
  let connection = pending.connection
  let consent = await connect(
    new URL(pending.url).pathname + new URL(pending.url).search,
    { headers: { cookie } },
  )
  let document = parseHTML(await consent.text()).document
  let fields = Object.fromEntries([...document.querySelectorAll('input')]
    .map((input) => [input.name, input.value]))
  let approved = await connect('/connect/service', {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  })
  equal(approved.status, 303)
  let query = `.entity.eid=${connection}&.connection`
  let [row] = await graph.query(whole(query))
  equal((row.connection as Comp).owner, person)
  let named = await graph.door!('/query?q=' + encodeURIComponent(query))
    .then((r) => r.json())
  equal(named[0].connection.owner, {
    eid: person,
    name: 'Named service customer',
  })
  let provenance: string | undefined
  env.DISPATCH = {
    get: () => ({
      fetch: (request) => {
        let origin = JSON.parse(request.headers.get('x-yak-command-source')!)
        provenance = origin.authority
        return Promise.resolve(
          Response.json({ person: request.headers.get('x-yak-person') }),
        )
      },
    }),
  }
  response = await at('/consumer/api/service', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      service: seller.app.eid,
      name: 'quote',
      args: {},
    }),
  })
  equal(response.status, 200, await response.clone().text())
  equal(
    JSON.parse((await response.json()).value.answer).person,
    person,
  )
  assert(provenance)
  let authority = await serviceFrom(env, provenance)
  assert(authority)
  equal(await verifyService(env, dir, authority), true)

  let notes = await dir.appAt(notebook)
  assert(notes)
  let own = mint(), other = mint()
  await metaOf(appStore(env.STORE, notes.space, notes.app, env), {
    ...KERNEL,
    'x-yak-role': 'editor',
    'x-yak-administrative': '1',
  }).apply([
    { entity: { eid: person }, person: {}, doc: { title: name } },
    {
      entity: { eid: own },
      draft: { by: person, place: 'own', text: 'Private words' },
    },
    {
      entity: { eid: other },
      draft: { by: stranger, place: 'other', text: 'Other words' },
    },
  ])
  let internal = metaOf(appStore(env.STORE, notes.space, notes.app, env), {
    'x-yak-person': person,
    'x-yak-role': 'editor',
  })
  let canonical = await internal.query('.draft')
  equal(canonical.map((row) => row.entity.eid), [own])
  equal((canonical[0].draft as Comp).by, person)
  equal(
    await metaOf(appStore(env.STORE, notes.space, notes.app, env)).query(
      '.draft',
    ),
    [],
  )
  for (let names of ['', '&names=0']) {
    let path = '/notes/api/query?q=.draft' + names
    let guest = await at(path)
    equal(guest.status, 200)
    equal(await guest.json(), [])
    let mine = await at(path, {
      headers: { cookie },
    })
    equal(mine.status, 200)
    let rows = await mine.json()
    equal(rows.map((r: { entity: { eid: string } }) => r.entity.eid), [own])
    equal(
      rows[0].draft.by,
      { eid: person, name: name },
    )
    let privateGraph = await at(
      '/consumer/api/query?q=.doc' + names,
    )
    equal(privateGraph.status, 401)
  }
})
