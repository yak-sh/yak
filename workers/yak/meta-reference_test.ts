import { assert, assertEquals as equal } from '@std/assert'
import { test } from '@yaks/testing'
import { type Comp, mint } from '@yaks/graph'
import { parseTools } from '@yaks/tools/declared'
import { publishService } from '@yaks/connections'
import { fresh, seed, signIn } from './probe.ts'
import { appStore, releaseOf } from './directory.ts'
import { keepDeclaration } from './declaration.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { serviceFrom, verifyService } from './service-call.ts'
import type { Env } from './env.ts'

test('internal graph reads retain canonical references while public named reads retain their privacy', async () => {
  let env!: Env, k = await fresh({}, (value) => env = value)
  try {
    let slug = 'refs' + mint().slice(0, 8)
    let owner = await seed(k, [{
      slug,
      apps: ['consumer', 'merchant', 'notes'],
    }])
    let graph = meta(env), read = (q: unknown) => graph.query(String(q))
    await graph.apply([
      {
        entity: { eid: owner.person },
        doc: { title: 'Named service customer' },
      },
      ...['consumer', 'merchant'].map((name) => ({
        entity: { eid: owner.eids[slug + '/' + name] },
        app: { access: 'private', version: 1, worker: 'worker.js' },
      })),
    ], KERNEL)
    let source = await k.dir.appAt(owner.eids[slug + '/consumer'])
    let seller = await k.dir.appAt(owner.eids[slug + '/merchant'])
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
    let response = await k.at(
      `${slug}.${k.host}`,
      '/consumer/api/service/connect',
      {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          service: seller.app.eid,
          operations: ['quote'],
        }),
      },
    )
    equal(response.status, 200, await response.clone().text())
    let connection = (await response.json()).connection
    let query = `.entity.eid=${connection}&.connection`
    let [row] = await graph.query(query)
    equal((row.connection as Comp).owner, owner.person)
    let named = await graph.door!('/query?q=' + encodeURIComponent(query))
      .then((r) => r.json())
    equal(named[0].connection.owner, {
      eid: owner.person,
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
    response = await k.at(`${slug}.${k.host}`, '/consumer/api/service', {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        service: seller.app.eid,
        name: 'quote',
        args: {},
      }),
    })
    equal(response.status, 200, await response.clone().text())
    equal(JSON.parse((await response.json()).value.answer).person, owner.person)
    assert(provenance)
    let authority = await serviceFrom(env, provenance)
    assert(authority)
    equal(await verifyService(env, k.dir, authority), true)

    let notes = await k.dir.appAt(owner.eids[slug + '/notes'])
    assert(notes)
    let stranger = await signIn(k), own = mint(), other = mint()
    await metaOf(appStore(env.STORE, notes.space, notes.app, env), {
      ...KERNEL,
      'x-yak-role': 'editor',
      'x-yak-administrative': '1',
    }).apply([
      { entity: { eid: owner.person }, person: {}, doc: { title: owner.name } },
      {
        entity: { eid: own },
        draft: { by: owner.person, place: 'own', text: 'Private words' },
      },
      {
        entity: { eid: other },
        draft: { by: stranger.person, place: 'other', text: 'Other words' },
      },
    ])
    let internal = metaOf(appStore(env.STORE, notes.space, notes.app, env), {
      'x-yak-person': owner.person,
      'x-yak-role': 'editor',
    })
    let canonical = await internal.query('.draft')
    equal(canonical.map((row) => row.entity.eid), [own])
    equal((canonical[0].draft as Comp).by, owner.person)
    equal(
      await metaOf(appStore(env.STORE, notes.space, notes.app, env)).query(
        '.draft',
      ),
      [],
    )
    for (let names of ['', '&names=0']) {
      let path = '/notes/api/query?q=.draft' + names
      let guest = await k.at(`${slug}.${k.host}`, path)
      equal(guest.status, 200)
      equal(await guest.json(), [])
      let mine = await k.at(`${slug}.${k.host}`, path, {
        headers: { cookie: owner.cookie },
      })
      equal(mine.status, 200)
      let rows = await mine.json()
      equal(rows.map((r: { entity: { eid: string } }) => r.entity.eid), [own])
      equal(
        rows[0].draft.by,
        { eid: owner.person, name: owner.name },
      )
      let privateGraph = await k.at(
        `${slug}.${k.host}`,
        '/consumer/api/query?q=.doc' + names,
      )
      equal(privateGraph.status, 401)
    }
  } finally {
    await k.stop()
  }
})
