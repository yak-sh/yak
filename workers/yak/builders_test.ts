// A builder in an app's store opens its ordinary transcript, and the account
// pays for the model turn that writes its output into that same store.
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
} from '@std/assert'
import { type Bundle, type Comp, identityEid } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { test, until } from '@yaks/testing'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { BUDGET, monthOf } from './meter.ts'
import { weigh } from '@yaks/model'
import { embeds, platform } from './testing.ts'
import creatures from '../../apps/vale/data/creatures/01.json' with {
  type: 'json',
}
import valeWords from '../../apps/vale/vocab.json' with { type: 'json' }

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let SOURCE = 'a0000000-0000-4000-8000-0000000000aa'
let BUILDER = 'a0000000-0000-4000-8000-0000000000bb'
let MODEL = '@cf/zai-org/glm-5.3-flash'
let PRICE = { input: 0.15, output: 0.5 }

let app = async (
  models = 0,
  access = 'private',
  chain = false,
  answer?: unknown[],
) => {
  let asked: string[] = []
  let AI = embeds({
    run: (model: string) => {
      asked.push(model)
      return Promise.resolve({
        response: JSON.stringify({
          outputs: answer ?? (chain && asked.length > 1 ? [] : [{
            slot: 'Ada',
            inputs: [SOURCE],
            components: {
              doc: { title: 'Ada', body: 'Keeps the forge.' },
              villager: { role: 'smith' },
            },
          }]),
        }),
        usage: { prompt_tokens: 1_000, completion_tokens: 100 },
      })
    },
    gateway: () => ({ getUrl: () => Promise.resolve('') }),
  })
  let p = platform('a probe secret', {
    AI,
    MODEL_FETCH: () =>
      Promise.resolve(
        new Response(
          '$0.15 per M input tokens, $0.5 per M output tokens',
        ),
      ),
  } as Partial<Env>)
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
  assertEquals(
    (await send('/apply', [{
      entity: { eid: identityEid('model', [MODEL]) },
      model: { name: MODEL },
    }])).status,
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
  return {
    asked,
    dir,
    send,
    read,
    kernel,
    [Symbol.dispose]: () => p[Symbol.dispose](),
  }
}

let creature = async (sounds?: Comp, hp = 36, step = true) => {
  let outputs = [
    {
      slot: 'kind',
      inputs: [SOURCE],
      components: {
        beast_design: { name: 'Moth' },
        combat: {
          lvl: 1,
          hp,
          dmg: 3,
          speed: 2,
          reach: 1,
          aggro: 3,
          xp: 12,
          boss: false,
        },
        loot: { drops: [] },
        doc: { body: 'A small moth with four feet and fluttering wings.' },
        ...(sounds ? { sounds } : {}),
      },
    },
    ...['cry', ...step ? ['step'] : []].map((slot) => ({
      slot,
      inputs: [SOURCE],
      components: {
        sfx: { name: `creature-${SOURCE}-${slot}`, loop: false },
        doc: { body: `An isolated moth ${slot}.` },
      },
    })),
  ]
  let v = await app(0, 'private', false, outputs)
  let names = ['beast_design', 'combat', 'loot', 'sounds', 'spawned', 'sfx']
  let words = valeWords.$defs as Record<string, unknown>
  assertEquals(
    (await v.send('/vocab', {
      $defs: Object.fromEntries(names.map((name) => [name, words[name]])),
    })).status,
    200,
  )
  assertEquals(
    (await v.send('/apply', [{
      ...creatures[0],
      using: {
        model: MODEL,
        provider: identityEid('provider', ['workers-ai']),
      },
    }, {
      entity: { eid: SOURCE },
      spawned: { lvl: 1, x: 0, z: 0, roam: 6 },
      doc: { body: 'A small moth.' },
    }])).status,
    200,
  )
  return v
}

for (
  let sounds of [undefined, {
    cry: `creature-${SOURCE}-cry`,
    step: 'model-supplied junk',
  }]
) {
  test(`the hosted creature builder wires sounds ${sounds ? 'over junk' : 'when omitted'}`, async () => {
    using v = await creature(sounds)
    let outputs = await until(async () => {
      let rows = await v.read('.built.current=true&*')
      return rows.length == 3 ? rows : null
    }, { label: 'creature sound outputs' })
    let slots = Object.fromEntries(outputs.map((row) => [
      String((row.built as Comp).slot),
      row,
    ]))
    assertEquals(slots.kind.sounds, {
      cry: slots.cry.entity.eid,
      step: slots.step.entity.eid,
    })
    let builds = [...new Set(outputs.map((row) => (row.built as Comp).build))]
    assertEquals(builds.length, 1)
    let [built] = await v.read(`.entity.eid=${builds[0]}&*`)
    assertEquals((built.build as Comp).for, SOURCE)
    assertEquals((built.build as Comp).builder, creatures[0].entity.eid)
    assertEquals(v.asked, [MODEL])
  })
}

for (
  let rejected of [
    {
      name: 'unsafe combat',
      hp: 0,
      step: true,
      reason: 'combat.hp',
    },
    {
      name: 'missing sound sibling',
      hp: 36,
      step: false,
      reason: 'step',
    },
  ]
) {
  test(`the hosted creature builder records ${rejected.name} as a failed build`, async () => {
    using v = await creature(undefined, rejected.hp, rejected.step)
    let [build] = await until(async () => {
      let rows = await v.read('.build&.failed&*')
      return rows.length ? rows : null
    }, { label: 'visible creature build failure' })
    assertStringIncludes(String((build.failed as Comp).reason), rejected.reason)
    assert((build.build as Comp).key)
    assertEquals((build.build as Comp).for, SOURCE)
    assertEquals((await v.read('.built')).length, 0)
    assertEquals((await v.read('.sfx')).length, 0)
    await until(async () => {
      let effects = await v.read('.effect.handler=builder_answer&*')
      return rejected.step
        ? effects.length == 0
        : effects.some((row) =>
          String((row.effect as Comp).error).includes('step')
        )
    }, { label: 'settled output refusal' })
    let before = await v.read('.call.source.build&*')
    assertEquals(
      (await v.kernel('/build', {
        builder: creatures[0].entity.eid,
        by: ADA,
      })).status,
      200,
    )
    assertEquals(await v.read('.call.source.build&*'), before)
    assertEquals(v.asked, [MODEL])
  })
}

let start = (v: Awaited<ReturnType<typeof app>>) =>
  v.send('/apply', [
    { entity: { eid: SOURCE }, doc: { title: 'Source', body: 'The village.' } },
    {
      entity: { eid: BUILDER },
      doc: { title: 'Villager', body: 'Builder documentation.' },
      content: { body: 'Make a villager from the source.' },
      using: {
        model: MODEL,
        provider: identityEid('provider', ['workers-ai']),
      },
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
  let cost = weigh(PRICE, {
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
        using: {
          model: MODEL,
          provider: identityEid('provider', ['workers-ai']),
        },
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
    let rows = await v.read(`.entry.session=${session}&.refusal&*`)
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
      using: {
        model: MODEL,
        provider: identityEid('provider', ['workers-ai']),
      },
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
      using: {
        model: MODEL,
        provider: identityEid('provider', ['workers-ai']),
      },
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

test('shadow outputs do not start downstream immediate builders', async () => {
  let v = await app(0, 'private', true)
  let next = crypto.randomUUID()
  assertEquals(
    (await v.send('/apply', [{
      entity: { eid: next },
      content: { body: 'Build from the generated villager.' },
      using: {
        model: MODEL,
        provider: identityEid('provider', ['workers-ai']),
      },
      builder: {
        query: '$v .villager, .doc.body=$description',
        to: toolEid('builder_model'),
        immediate: true,
      },
    }])).status,
    200,
  )
  assertEquals((await start(v)).status, 200)
  await until(() => v.asked.length == 2, { label: 'main downstream turn' })
  assertEquals(
    (await v.kernel('/build', {
      builder: BUILDER,
      only: [SOURCE],
      template: 'A review-only variant.',
    })).status,
    200,
  )
  await until(() => v.asked.length == 3, { label: 'shadow model turn' })
  await until(async () => (await v.read('.build&*')).length == 3, {
    label: 'shadow build retained',
  })
  // The shadow model returns no output in this fixture, so exercise the
  // generated-row write door explicitly with its shadow build provenance.
  let [shadow] = (await v.read('.build&*')).filter((b) =>
    (b.build as Comp).variant != 'main'
  )
  assertEquals(
    (await v.kernel('/apply', [{
      entity: { eid: crypto.randomUUID() },
      villager: { role: 'smith' },
      doc: { body: 'Review-only smith.' },
      built: {
        build: shadow.entity.eid,
        slot: 'Ada',
        key: (shadow.build as Comp).key,
      },
    }])).status,
    200,
  )
  assertEquals((await v.read(`.build.builder=${next}&*`)).length, 1)
})

test('builder_supply in an app store is current without any model spending', async () => {
  let v = await app()
  let artifact = 'a0000000-0000-4000-8000-0000000000cc'
  assertEquals(
    (await v.send('/apply', [{
      entity: { eid: SOURCE },
      doc: { title: 'Source', body: 'Village.' },
    }, {
      entity: { eid: artifact },
      artifact: { address: 'existing-song', media_type: 'audio/wav', size: 4 },
    }, {
      entity: { eid: BUILDER },
      content: { body: 'Make a villager from $body.' },
      using: {
        model: MODEL,
        provider: identityEid('provider', ['workers-ai']),
      },
      builder: {
        query: '$s .doc.title=Source, doc.body=$body',
        to: toolEid('builder_model'),
      },
      staged: {},
    }])).status,
    200,
  )
  let ask = {
    builder: BUILDER,
    for: SOURCE,
    slot: 'song',
    artifact,
    by: ADA,
    args: { prompt: 'Original prompt', model: 'Original model', loudness: -16 },
  }
  assertEquals((await v.send('/supply', ask)).status, 404)
  let r = await v.kernel('/supply', ask)
  assertEquals(r.status, 200)
  let { output } = await r.json()
  let [made] = await v.read(`.entity.eid=${output}&*`)
  assertEquals((made.built as Comp).artifact, artifact)
  assertEquals((made.built as Comp).current, true)
  let [call] = await v.read(`.entity.eid=${(made.built as Comp).call}&*`)
  let args = (call.call as Comp).args as Comp
  assertEquals(args.prompt, ask.args.prompt)
  assertEquals(args.model, ask.args.model)
  assertEquals(args.loudness, -16)
  assertEquals((call.cost as Comp).dollars, 0)
  assertEquals(v.asked, [])
  assertEquals(
    (await v.kernel('/build', { builder: BUILDER, by: ADA })).status,
    200,
  )
  assertEquals((await v.read('.call')).length, 1)
  assertEquals(v.asked, [])
})

test('hosted supply replaces a named slot without a model turn', async () => {
  let v = await app()
  let artifact = crypto.randomUUID()
  let replacement = crypto.randomUUID()
  await v.send('/apply', [
    { entity: { eid: SOURCE }, doc: { title: 'Source' } },
    {
      entity: { eid: artifact },
      artifact: { address: 'audio', media_type: 'audio/wav', size: 4 },
    },
    {
      entity: { eid: replacement },
      artifact: { address: 'replacement', media_type: 'audio/wav', size: 8 },
    },
    {
      entity: { eid: BUILDER },
      staged: {},
      builder: { query: '.doc.title=Source', to: toolEid('builder_model') },
    },
  ])
  let one = await v.kernel('/supply', {
    builder: BUILDER,
    for: SOURCE,
    artifact,
    slot: 'song',
    by: ADA,
  })
  let first = (await one.json()).output
  let two = await v.kernel('/supply', {
    builder: BUILDER,
    for: SOURCE,
    artifact: replacement,
    slot: 'song',
    by: ADA,
  })
  let second = (await two.json()).output
  assertEquals(first, second)
  assertEquals((await v.read('.built.current=true'))[0].entity.eid, second)
  assertEquals(
    ((await v.read('.built&*'))[0].built as Comp).artifact,
    replacement,
  )
  let calls = await v.read('.call.source.build&*')
  let choice = await v.kernel('/choose', { output: first, by: ADA })
  assertEquals(choice.status, 200)
  assertEquals((await v.read('.built.current=true'))[0].entity.eid, first)
  assertEquals((await v.read('.built')).length, 1)
  assertEquals((await v.read('.call.source.build')).length, calls.length)
  assertEquals(v.asked.length, 0)
})
