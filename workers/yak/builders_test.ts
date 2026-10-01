// A builder in an app's store opens its ordinary transcript, and the account
// pays for the model turn that writes its output into that same store.
import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { test, until } from '@yaks/testing'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { BUDGET, monthOf } from './meter.ts'
import { CATALOGUE, priceOf } from './models.ts'
import { weigh } from '@yaks/model'
import { embeds, platform } from './testing.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let SOURCE = 'a0000000-0000-4000-8000-0000000000aa'
let BUILDER = 'a0000000-0000-4000-8000-0000000000bb'
let MODEL = CATALOGUE.find((r) => r.offered && r.output > 0)!.name

let app = async (models = 0, access = 'private', chain = false) => {
  let asked: string[] = []
  let AI = embeds({
    run: (model: string) => {
      asked.push(model)
      return Promise.resolve({
        response: JSON.stringify({
          outputs: chain && asked.length > 1 ? [] : [{
            slot: 'Ada',
            inputs: [SOURCE],
            components: {
              doc: { title: 'Ada', body: 'Keeps the forge.' },
              villager: { role: 'smith' },
            },
          }],
        }),
        usage: { prompt_tokens: 1_000, completion_tokens: 100 },
      })
    },
    gateway: () => ({ getUrl: () => Promise.resolve('') }),
  })
  let p = platform('a probe secret', { AI } as Partial<Env>)
  let dir = directory({ fetch: (r) => dirPart.fetch(r, p.env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        space: { slug: 'builder-test' },
        ...(models ? { meter: { month: monthOf(new Date()), models } } : {}),
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
      {
        entity: { eid: '$app' },
        app: {
          space: '$space',
          slug: 'forge',
          store: 'builder-test/forge',
          access,
        },
      },
    ],
  }, { 'x-yak-role': 'owner' })
  let row = (await dir.app((await dir.space('builder-test'))!, 'forge'))!
  let store = p.env.STORE.get(p.env.STORE.idFromName('builder-test/forge'))
  let headers = {
    'x-store': 'builder-test/forge',
    'x-yak-app': row.eid,
    'x-yak-access': access,
  }
  let as = (person: string | null) => ({
    ...headers,
    ...(person ? { 'x-yak-person': person, 'x-yak-role': 'owner' } : {}),
  })
  let send = (path: string, body: unknown, person: string | null = ADA) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers: as(person),
        body: JSON.stringify(body),
      }),
    )
  let read = async (query: string): Promise<Bundle[]> =>
    await (await store.fetch(
      new Request(
        `http://store/query?q=${encodeURIComponent(query)}`,
        { headers: as(ADA) },
      ),
    )).json()
  assertEquals(
    (await send('/vocab', {
      $defs: {
        villager: {
          component: true,
          properties: { role: { type: 'string' } },
        },
      },
    })).status,
    200,
  )
  // The kernel's own door onto the store, as the connector's tools reach it.
  let kernel = (path: string, body: unknown) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers: { ...headers, 'x-yak-kernel': '1' },
        body: JSON.stringify(body),
      }),
    )
  return { asked, dir, send, read, kernel }
}

let start = (v: Awaited<ReturnType<typeof app>>) =>
  v.send('/apply', [
    { entity: { eid: SOURCE }, doc: { title: 'Source', body: 'The village.' } },
    {
      entity: { eid: BUILDER },
      doc: { title: 'Villager', body: 'Builder documentation.' },
      content: { body: 'Make a villager from the source.' },
      using: { model: MODEL },
      builder: {
        query: '.doc.title=Source',
        to: toolEid('builder_model'),
      },
    },
  ])

test('a hosted builder writes named outputs and spends the account budget', async () => {
  let v = await app()
  assertEquals((await start(v)).status, 200)
  let [built] = await until(async () => {
    let rows = await v.read('.built&*')
    return rows.length ? rows : null
  }, { label: 'builder output' })
  assertEquals((built.doc as Comp).body, 'Keeps the forge.')
  assertEquals((built.villager as Comp).role, 'smith')
  let buildId = String((built.built as Comp).build)
  let [build] = await v.read(`.entity.eid=${buildId}&.build&*`)
  assertEquals((build.build as Comp).builder, BUILDER)
  let [cite] = await v.read(`.edge.from=${built.entity.eid}&.cites&*`)
  assertEquals((cite.edge as Comp).to, SOURCE)
  assert(typeof (cite.cites as Comp).hash == 'string')
  let call = String((built.built as Comp).call)
  assertEquals((await v.read(`.session.source=${call}&*`)).length, 1)
  assertEquals(v.asked.length, 1)
  let price = priceOf(v.asked[0])
  assert(price)
  let cost = weigh(price, {
    input_tokens: 1_000,
    output_tokens: 100,
  })
  await until(async () => (await v.dir.space('builder-test'))?.meter?.models)
  assertAlmostEquals((await v.dir.space('builder-test'))!.meter!.models, cost)
})

test('builder_build tries a staged builder on the rows it names, as the caller', async () => {
  let v = await app()
  let OTHER = 'a0000000-0000-4000-8000-0000000000ab'
  assertEquals(
    (await v.send('/apply', [
      { entity: { eid: SOURCE }, doc: { title: 'Source', body: 'Village.' } },
      { entity: { eid: OTHER }, doc: { title: 'Source', body: 'Hill.' } },
      {
        entity: { eid: BUILDER },
        content: { body: 'Make a villager from $body.' },
        using: { model: MODEL },
        builder: {
          query: '$s .doc.title=Source, doc.body=$body',
          to: toolEid('builder_model'),
        },
        staged: {},
      },
    ])).status,
    200,
  )
  assertEquals((await v.send('/build', { builder: BUILDER })).status, 404)
  let refused = await v.kernel('/build', { builder: BUILDER, only: [BUILDER] })
  assertEquals(refused.status, 400)
  let asked = await v.kernel('/build', {
    builder: BUILDER,
    only: [SOURCE],
    by: ADA,
  })
  assertEquals(asked.status, 200)
  assertEquals((await asked.json()).builds.length, 1)
  await until(async () => (await v.read('.built&*')).length, {
    label: 'builder output',
  })
  let builds = await v.read('.build&*')
  assertEquals(builds.map((b) => (b.build as Comp).for), [SOURCE])
  assertEquals((builds[0].created as Comp).by, ADA)
})

test('a hosted builder cannot spend beyond the account budget', async () => {
  let v = await app(BUDGET.free)
  assertEquals((await start(v)).status, 200)
  let [run] = await until(async () => {
    let rows = await v.read('.build&*')
    return rows.length ? rows : null
  }, { label: 'builder run' })
  let call = String((run.build as Comp).call)
  let [opened] = await until(async () => {
    let rows = await v.read(`.session.source=${call}&*`)
    return rows.length ? rows : null
  }, { label: 'builder session' })
  let session = opened.entity.eid
  await until(async () => {
    let rows = await v.read(`.entry.session=${session}&.error&*`)
    return rows.length ? rows : null
  }, { label: 'budget refusal' })
  assertEquals((await v.read('.built&*')).length, 0)
  assertEquals(v.asked.length, 0)
})

test('an open app cannot let a visitor start a builder at its account expense', async () => {
  let v = await app(0, 'open')
  let refused = await v.send('/apply', [
    {
      entity: { eid: BUILDER },
      content: { body: 'Make a villager.' },
      using: { model: MODEL },
      builder: { to: toolEid('builder_model') },
    },
  ], null)
  assertEquals(refused.status, 403)
  assertEquals((await v.read('.builder&*')).length, 0)
  assertEquals(v.asked.length, 0)
})

test('a hosted generated row starts the next immediate builder', async () => {
  let v = await app(0, 'private', true)
  let next = crypto.randomUUID()
  assertEquals(
    (await v.send('/apply', [{
      entity: { eid: next },
      content: { body: 'Build from the generated villager.' },
      using: { model: MODEL },
      builder: {
        query: '$v .villager, .doc.body=$description',
        to: toolEid('builder_model'),
        immediate: true,
      },
    }])).status,
    200,
  )
  assertEquals((await start(v)).status, 200)
  await until(() => v.asked.length == 2, {
    label: 'chained builder model turn',
  })
  let [output] = await v.read('.villager&.built&*')
  let builds = await v.read(`.build.builder=${next}&*`)
  assertEquals(builds.length, 1)
  assertEquals((builds[0].build as Comp).for, output.entity.eid)
})
