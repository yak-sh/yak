// Published copies use a lent sentinel through the kernel's install, update,
// connection and egress doors, over stores held in this process.
// Run this end-to-end check explicitly:
// deno test -A --no-check workers/yak/lending_check.ts
import { cleanup, test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import {
  connect,
  envOf,
  integrationEid,
  need,
  registration,
  using,
} from '@yaks/connections'
import type { Bundle, Comp } from '@yaks/graph'
import { d1 } from '../../packages/d1/testing.ts'
import type { D1Like } from '@yaks/d1'
import {
  CALLBACK,
  callback,
  connecting,
  connectionsOf,
  ctxOf,
} from './connections.ts'
import { appStore, directory, over } from './directory.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { outbound } from './outbound.ts'
import { PUBLISHED } from './published.ts'
import { lasting } from './testing.ts'
import { call } from './tools.ts'
import { minted } from './session.ts'
import { reaching } from './agent.ts'

let comp = (b: Bundle | undefined, key: string) => (b?.[key] ?? {}) as Comp
let key = 'lender-private-key'

let setup = async (words = false) => {
  let p = lasting('lending-test', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  })
  let at = meta(p.env)
  let dir = directory({ fetch: over(at) }, true)
  let people = [crypto.randomUUID(), crypto.randomUUID()]
  await at.apply(
    people.flatMap((person, n) => [
      { entity: { eid: person }, person: {} },
      {
        entity: { eid: `$space${n}` },
        doc: { title: n ? 'Borrower' : 'Lender' },
        space: {
          slug: n ? 'borrower' : 'lender',
          store: n ? 'borrower' : 'lender',
        },
      },
      {
        entity: { eid: `$seat${n}` },
        member: { space: `$space${n}`, person, role: 'owner' },
      },
    ]) as Bundle[],
    KERNEL,
  )
  let [home, away] = await Promise.all(
    ['lender', 'borrower'].map(async (name, n) => {
      let space = (await dir.space(name))!
      let ctx = { env: p.env, dir, person: people[n] }
      let run = (name: string, args: Record<string, unknown> = {}) =>
        call(ctx, name, { space: space.slug, app: 'notes', ...args })
      return { space, ctx, run }
    }),
  )
  await home.run('app_new', { slug: 'notes', title: 'Notes' })
  await home.run('app_files', {
    files: [
      { path: 'index.html', content: '<h1>Notes</h1>' },
      ...words
        ? [{
          path: 'vocab.json',
          content: JSON.stringify({
            $defs: {
              lendingnote: {
                component: true,
                type: 'object',
                properties: { body: { type: 'string' } },
              },
            },
          }),
        }]
        : [],
    ],
  })
  await home.run('app_deploy')
  let app = (await dir.app(home.space, 'notes'))!
  let c = ctxOf(p.env)
  let add = async (integration: string, binding: string) => {
    let made = await c.graph.apply(
      await need(c.graph.read, {
        owner: home.space.eid,
        app: app.eid,
        integration,
        hosts: ['api.weather.test'],
        binding,
      }),
    )
    let connection = made.find((b) => b.connection)!.entity.eid
    await connect(c, connection, { key })
    await home.run('connection_lend', { integration, cap: 2 })
    return connection
  }
  let connection = await add('Weather', 'SKY')
  await home.run('app_publish', { name: 'lent-notes' })
  let install = await away.run('app_install', { name: 'lent-notes' })
  let copy = (await dir.app(away.space, 'notes'))!
  let links = () => c.graph.read(`.edge.from=${copy.eid}&.uses&*`)
  let post = (fields: Record<string, string>) => {
    let form = new FormData()
    for (let [name, value] of Object.entries(fields)) form.set(name, value)
    return connecting(
      new Request('https://yaks.app/manage/connections?space=borrower'),
      p.env,
      away.space,
      { person: people[1], role: 'owner' },
      form,
    )
  }
  return {
    p,
    at,
    dir,
    home,
    away,
    app,
    copy,
    c,
    add,
    connection,
    install,
    links,
    post,
  }
}

let installed = await setup()
let sourceData = metaOf(
  appStore(installed.p.env.STORE, installed.home.space, installed.app),
)
await sourceData.apply([{
  entity: { eid: '$note' },
  doc: { title: 'The lender’s private note' },
}], KERNEL)
test('an installed copy borrows a host-capped sentinel and egress alone swaps its key', async () => {
  let s = installed
  cleanup(s.p[Symbol.asyncDispose])
  let [loan] = await s.links()
  assertEquals(comp(loan, 'uses'), {
    binding: 'SKY',
    cap: 2,
    lender: s.app.eid,
  })
  assertEquals(comp(loan, 'edge').to, s.connection)
  let ownData = metaOf(appStore(s.p.env.STORE, s.away.space, s.copy))
  assertEquals(
    (await sourceData.query('.doc.title="The lender’s private note"')).length,
    1,
  )
  assertEquals(
    await ownData.query('.doc.title="The lender’s private note"'),
    [],
  )
  assertStringIncludes(s.install.text, 'Weather')
  let env = await envOf(s.c, s.copy.eid)
  assert(env.SKY.startsWith('yak_sentinel_'))
  assert(!JSON.stringify(env).includes(key))
  let listed = await PUBLISHED.find((t) => t.name == 'connection_list')!.run(
    s.away.ctx,
    { space: 'borrower' },
  )
  assertStringIncludes(listed.text, 'Weather')
  assertStringIncludes(listed.text, 'Lender')
  assert(!listed.text.includes(key))
  let shown = await connectionsOf(s.p.env, [s.away.space], s.away.ctx.person)
  assertEquals(shown.list.length, 0)
  assertEquals(shown.borrowed.map((b) => [b.integration, b.app.cap]), [[
    'Weather',
    2,
  ]])
  let sent: Request[] = []
  let was = globalThis.fetch
  globalThis.fetch = (input, init) => {
    sent.push(new Request(input, init))
    return Promise.resolve(new Response('ok'))
  }
  try {
    let out = () =>
      outbound(
        new Request('https://api.weather.test/', {
          headers: { authorization: `Bearer ${env.SKY}` },
        }),
        s.p.env,
        { app: s.copy.eid, level: 'owner', person: s.away.ctx.person },
      )
    assertEquals((await out()).status, 200)
    await s.p.settled()
    assertEquals((await out()).status, 200)
    await s.p.settled()
    let refused = await out()
    assertEquals(refused.status, 403)
    assertStringIncludes(await refused.text(), 'Lender')
    assertEquals(sent.map((r) => r.headers.get('authorization')), [
      `Bearer ${key}`,
      `Bearer ${key}`,
    ])
  } finally {
    globalThis.fetch = was
  }
  await assertRejects(() =>
    s.at.apply([{
      entity: { eid: loan.entity.eid },
      uses: { cap: 100 },
    }], { 'x-yak-person': s.away.ctx.person, 'x-yak-role': 'owner' })
  )
})

let updated = await setup()
await updated.post({
  do: 'own',
  app: updated.copy.eid,
  connection: updated.connection,
  key: 'own-weather-key',
})
let ownBeforeUpdate = (await envOf(updated.c, updated.copy.eid)).SKY
test('an update carries a new loan as host while keeping the copy’s existing connection', async () => {
  let s = updated
  cleanup(s.p[Symbol.asyncDispose])
  let second = await s.add('Forecast', 'FORECAST')
  await s.home.run('app_files', {
    files: [{ path: 'index.html', content: '<h1>Notes v2</h1>' }],
  })
  await s.home.run('app_deploy')
  await s.home.run('app_publish', { name: 'lent-notes' })
  await s.away.run('app_update')
  let links = await s.links()
  assertEquals(links.length, 2)
  let loan = links.find((b) => comp(b, 'edge').to == second)!
  assertEquals(comp(loan, 'uses'), {
    binding: 'FORECAST',
    cap: 2,
    lender: s.app.eid,
  })
  assertEquals((await envOf(s.c, s.copy.eid)).SKY, ownBeforeUpdate)
  assert(ownBeforeUpdate != (await envOf(s.c, s.app.eid)).SKY)
})

let replaced = await setup()
test('the borrower replaces a loan with its own key without changing the lender’s', async () => {
  let s = replaced
  cleanup(s.p[Symbol.asyncDispose])
  let said = await s.post({
    do: 'own',
    app: s.copy.eid,
    connection: s.connection,
    key: 'borrower-key',
  })
  assert(!(said instanceof Response))
  assertEquals(said.no, false)
  let held = await using(s.c.graph.read, {
    app: s.copy.eid,
    integration: 'Weather',
  })
  assertEquals(comp(held, 'connection').owner, s.away.space.eid)
  assertEquals(comp(held, 'connection').status, 'connected')
  assertEquals(comp((await s.links())[0], 'uses'), { binding: 'SKY' })
  assert(
    (await envOf(s.c, s.copy.eid)).SKY != (await envOf(s.c, s.app.eid)).SKY,
  )
  assertEquals(
    (await using(s.c.graph.read, { app: s.app.eid, integration: 'Weather' }))!
      .entity.eid,
    s.connection,
  )
})

let recalled = await setup()
test('recalling a lend restores an ask in the borrower’s space', async () => {
  let s = recalled
  cleanup(s.p[Symbol.asyncDispose])
  await s.home.run('connection_lend', { integration: 'Weather', cap: null })
  let asked = await using(s.c.graph.read, {
    app: s.copy.eid,
    integration: 'Weather',
  })
  assertEquals(comp(asked, 'connection').owner, s.away.space.eid)
  assertEquals(comp(asked, 'connection').status, 'needed')
  assertEquals(comp((await s.links())[0], 'uses'), { binding: 'SKY' })
  assertEquals(await envOf(s.c, s.copy.eid), {})
  assert((await envOf(s.c, s.app.eid)).SKY)
})

let signed = await setup()
await signed.c.graph.apply([
  registration('weather', { id: 'weather-client' }),
  {
    entity: { eid: integrationEid('Weather') },
    integration: {
      authorize: 'https://auth.weather.test/authorize',
      token: 'https://auth.weather.test/token',
      client: 'weather',
    },
  },
])
let ownAsk = await signed.c.graph.apply(
  await need(signed.c.graph.read, {
    owner: signed.away.space.eid,
    integration: 'Weather',
  }),
)
let ownConnection = ownAsk.find((b) => b.connection)!
await signed.c.graph.apply([{
  ...ownConnection,
  connection: {
    ...comp(ownConnection, 'connection'),
    status: 'connected',
    account: 'borrower@weather.test',
  },
  secret: {
    ...comp(ownConnection, 'secret'),
    value: JSON.stringify({ access_token: 'old-token' }),
  },
}])
test('an OAuth replacement attaches the existing account that the callback renewed', async () => {
  let s = signed
  cleanup(s.p[Symbol.asyncDispose])
  let went = await s.post({
    do: 'own',
    app: s.copy.eid,
    connection: s.connection,
  })
  assert(went instanceof Response)
  let state = new URL(went.headers.get('location')!).searchParams.get('state')
  let attempt = went.headers.get('set-cookie')!.split(';')[0]
  let session = (await minted(
    new Request('https://yaks.app/'),
    s.p.env,
    'lending-test',
    s.away.ctx.person,
  )).split(';')[0]
  let was = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(Response.json({
      access_token: 'renewed-token',
      id_token: `e30.${
        btoa(JSON.stringify({ email: 'borrower@weather.test' }))
      }.signature`,
    }))
  try {
    let back = await callback({
      env: s.p.env,
      req: new Request(`https://yaks.app${CALLBACK}?code=C&state=${state}`, {
        headers: { cookie: `${attempt}; ${session}` },
      }),
      path: CALLBACK,
      space: null,
    })
    assertEquals(back!.status, 303)
    assertStringIncludes(back!.headers.get('location')!, 'connected=1')
  } finally {
    globalThis.fetch = was
  }
  let connected = await using(s.c.graph.read, {
    app: s.copy.eid,
    integration: 'Weather',
  })
  assertEquals(connected!.entity.eid, ownConnection.entity.eid)
  assertEquals(comp((await s.links())[0], 'uses'), { binding: 'SKY' })
})

let shared = await setup(true)
await shared.away.run('app_install', { name: 'lent-notes', as: 'own' })
let sibling = (await shared.dir.app(shared.away.space, 'own'))!
let friendData = metaOf(
  appStore(shared.p.env.STORE, shared.away.space, shared.copy),
)
await friendData.apply([{
  entity: { eid: '$friend' },
  lendingnote: { body: 'The friend’s note' },
}], KERNEL)
await metaOf(appStore(shared.p.env.STORE, shared.home.space, shared.app)).apply(
  [{
    entity: { eid: '$source' },
    lendingnote: { body: 'The lender’s note' },
  }],
  KERNEL,
)
let graph = await reaching(
  shared.away.ctx,
  [shared.copy, sibling].map((app) => ({
    space: shared.away.space,
    app,
    who: { person: shared.away.ctx.person, role: 'owner' },
  })),
)
test('a named connector read from a second installed copy follows its component home', async () => {
  cleanup(shared.p[Symbol.asyncDispose])
  let rows = await graph.read('.in=borrower/own&.lendingnote')
  assertEquals(rows.map((b) => comp(b, 'lendingnote').body), [
    'The friend’s note',
  ])
})
