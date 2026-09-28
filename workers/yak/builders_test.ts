// A builder in an app's store opens its ordinary transcript, and the account
// pays for the model turn that writes its output into that same store.
import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { until } from '../../bin/testing.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { BUDGET, monthOf } from './meter.ts'
import { priceOf, weigh } from './models.ts'
import { platform } from './testing.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let SOURCE = 'a0000000-0000-4000-8000-0000000000aa'
let BUILDER = 'a0000000-0000-4000-8000-0000000000bb'

let app = async (models = 0, access = 'private') => {
  let asked: string[] = []
  let AI = {
    run: (model: string) => {
      asked.push(model)
      return Promise.resolve({
        response: JSON.stringify({
          outputs: [{
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
  }
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
  return { asked, dir, send, read }
}

let start = (v: Awaited<ReturnType<typeof app>>) =>
  v.send('/apply', [
    { entity: { eid: SOURCE }, doc: { title: 'Source', body: 'The village.' } },
    {
      entity: { eid: BUILDER },
      doc: { title: 'Villager', body: 'Make a villager from the source.' },
      builder: { query: '.doc.title=Source' },
    },
  ])

Deno.test('a hosted builder writes named outputs and spends the account budget', async () => {
  let v = await app()
  assertEquals((await start(v)).status, 200)
  let [built] = await until(async () => {
    let rows = await v.read('.built&*')
    return rows.length ? rows : null
  }, { label: 'builder output' })
  assertEquals((built.doc as Comp).body, 'Keeps the forge.')
  assertEquals((built.villager as Comp).role, 'smith')
  assertEquals((built.built as Comp).builder, BUILDER)
  let [cite] = await v.read(`.edge.from=${built.entity.eid}&.cites&*`)
  assertEquals((cite.edge as Comp).to, SOURCE)
  assert(typeof (cite.cites as Comp).hash == 'string')
  let session = (built.built as Comp).session
  assertEquals((await v.read(`.eid=${session}&.session&*`)).length, 1)
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

Deno.test('a hosted builder cannot spend beyond the account budget', async () => {
  let v = await app(BUDGET.free)
  assertEquals((await start(v)).status, 200)
  let [run] = await until(async () => {
    let rows = await v.read('.build&*')
    return rows.length ? rows : null
  }, { label: 'builder run' })
  let session = (run.build as Comp).session
  assert(typeof session == 'string')
  await until(async () => {
    let rows = await v.read(`.entry.session=${session}&.error&*`)
    return rows.length ? rows : null
  }, { label: 'budget refusal' })
  assertEquals((await v.read('.built&*')).length, 0)
  assertEquals(v.asked.length, 0)
})

Deno.test('an open app cannot let a visitor start a builder at its account expense', async () => {
  let v = await app(0, 'open')
  let refused = await v.send('/apply', [
    {
      entity: { eid: BUILDER },
      doc: { body: 'Make a villager.' },
      builder: {},
    },
  ], null)
  assertEquals(refused.status, 403)
  assertEquals((await v.read('.builder&*')).length, 0)
  assertEquals(v.asked.length, 0)
})
