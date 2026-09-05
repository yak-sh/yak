/// <reference lib="deno.ns" />
// The builder's loop (T-34239), on the stand-in: a scripted model instead of
// a provider, and everything else the code that runs in production — the
// platform's own tools, the directory, the Store, the bucket, the serving
// door. What is proved here is that the loop is a MODEL away from building
// somebody an app: the fake asks for app_new, app_files and app_deploy, the
// tools run as the person, and the page is served at the app's own address.
//
// The three ends are held too — nobody, too many rounds, no key — because
// each one is a sentence somebody reads, not an exception somebody catches.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import * as apps from './apps.ts'
import {
  ANON,
  build,
  BUSY,
  fake,
  idOf,
  modelOf,
  NO_AI,
  NO_KEY,
  roster,
} from './builder.ts'
import { directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { platform } from './harness.ts'
import { BUILDS, monthOf } from './meter.ts'
import type { Who } from './session.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

let owner: Who = { person: ADA, role: 'owner' }
let nobody: Who = { person: null, role: null }

// A space with Ada in it, written the way `space_new` writes one — and no app,
// because the app is what the builder is here to make.
let seeded = async (vars: Partial<Env> = {}) => {
  let { env } = platform(SECRET, vars)
  let dir = dirOf(env)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  return { env, space: (await dir.space('ada'))! }
}

let dirOf = (env: Env) =>
  directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)

let call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  args: JSON.stringify(args),
})

let asked = (text: string) => [{ said: 'person' as const, text }]

// A space that has never paid, said the way the directory says one.
let free = (space: Space) => ({ ...space, tier: null })

Deno.test('the fake model builds an app end to end, and it serves', async () => {
  let { env, space } = await seeded()
  let model = fake([
    {
      text: 'Making it now.',
      calls: [call('c1', 'app_new', { slug: 'recipes', title: 'Recipes' })],
    },
    {
      calls: [call('c2', 'app_files', {
        app: 'recipes',
        files: [{ path: 'index.html', content: '<h1>Lemon cake</h1>' }],
      })],
    },
    { calls: [call('c3', 'app_deploy', { app: 'recipes' })] },
    { text: 'It is at https://ada.yaks.app/recipes/' },
  ])
  let out = await build(env, owner, space, asked('a recipe box please'), {
    model,
  })

  assertEquals(out.refused, undefined)
  assertEquals(out.rounds, 4)
  assertStringIncludes(out.text, 'ada.yaks.app/recipes/')

  // Every tool answered, and each answer came back to the model as a line of
  // its own — which is what makes the next turn able to correct the last one.
  let ran = out.lines.filter((l) => l.said == 'tool')
  assertEquals(ran.map((l) => l.said == 'tool' && l.name), [
    'app_new',
    'app_files',
    'app_deploy',
  ])
  for (let l of ran) assert(l.said == 'tool' && l.text.length > 0)

  // The system prompt is the connector's own instructions and the guide, so
  // the agent we run is taught what an agent somebody brings is taught.
  assertStringIncludes(model.asked[0].system, 'app_new — the app')
  assertStringIncludes(model.asked[0].system, 'Building an app on yaks.app')
  // And the tools it was offered are the platform's, with the table's own
  // schema — `app_files` takes a files list, said as JSON Schema.
  let files = model.asked[0].fns.find((f) => f.name == 'app_files')!
  assertEquals(
    (files.parameters.properties.files as { type: string }).type,
    'array',
  )

  // The app the loop made serves its page at its own address.
  let page = await apps.fetch(new Request('https://ada.yaks.app/recipes/'), env)
  assertEquals(page.status, 200)
  assertStringIncludes(await page.text(), 'Lemon cake')

  // And the deploy is one build on the meter, with what it cost (T-34241).
  let after = (await dirOf(env).space('ada'))!
  assertEquals(after.meter?.built, 1)
  assertEquals(after.meter?.builds, 1)
  assertEquals(after.meter?.month, monthOf(new Date()))
})

Deno.test('a conversation that ships nothing is no build at all', async () => {
  let { env, space } = await seeded()
  let model = fake([
    { calls: [call('c1', 'app_list', {})] },
    { text: 'you have nothing yet' },
  ])
  await build(env, owner, space, asked('what do i have'), { model })

  assertEquals((await dirOf(env).space('ada'))!.meter?.built, undefined)
})

Deno.test('a space at its build ceiling is told so before a token is spent', async () => {
  let { env, space } = await seeded()
  let model = fake([{ text: 'never asked' }])
  // The free tier is one build for the life of the space (meter.ts BUILDS).
  let full = {
    ...space,
    meter: {
      month: monthOf(new Date()),
      built: BUILDS.free,
      builds: 0,
      tokens: 0,
    },
  } as Space
  let out = await build(env, owner, full, asked('another one please'), {
    model,
  })

  assert(out.refused)
  assertStringIncludes(out.refused, 'ada')
  assertEquals(out.rounds, 0)
  assertEquals(model.asked.length, 0)
  assertEquals(out.usage, { input: 0, output: 0, cached: 0 })
})

Deno.test('an anonymous caller is refused before a tool runs', async () => {
  let { env, space } = await seeded()
  let model = fake([{ text: 'never asked' }])
  let out = await build(env, nobody, space, asked('build me something'), {
    model,
  })

  assertEquals(out.refused, ANON)
  assertEquals(out.text, ANON)
  assertEquals(out.rounds, 0)
  assertEquals(model.asked.length, 0)
})

Deno.test('the round limit stops a looping model', async () => {
  let { env, space } = await seeded()
  // A model that only ever asks for the app list, forever.
  let model = fake(
    Array.from({ length: 9 }, (_, i) => ({
      calls: [call(`c${i}`, 'app_list', {})],
    })),
  )
  let out = await build(env, owner, space, asked('go'), { model, rounds: 3 })

  assertEquals(out.rounds, 3)
  assertEquals(model.asked.length, 3)
  assertStringIncludes(out.refused!, 'after 3 rounds')
  assertStringIncludes(out.text, 'What is built so far is built')
})

Deno.test('the wall budget stops a slow one', async () => {
  let { env, space } = await seeded()
  let clock = 0
  let model = fake(
    Array.from({ length: 5 }, () => ({ calls: [call('c', 'app_list', {})] })),
  )
  let out = await build(env, owner, space, asked('go'), {
    model,
    ms: 1_000,
    // The first turn is inside the budget; the second is not.
    now: () => (clock += 900),
  })

  assertEquals(out.rounds, 1)
  assertStringIncludes(out.refused!, 'out of time after 1 seconds')
})

Deno.test('usage is summed over every response', async () => {
  let { env, space } = await seeded()
  let model = fake([
    {
      calls: [call('c1', 'app_list', {})],
      usage: { input: 100, output: 20, cached: 10 },
    },
    { text: 'nothing here yet', usage: { input: 300, output: 5, cached: 90 } },
  ])
  let out = await build(env, owner, space, asked('what do i have'), { model })

  assertEquals(out.usage, { input: 400, output: 25, cached: 100 })
  // And each response kept what it cost, beside what it said.
  assertEquals(
    out.lines.filter((l) => l.said == 'builder').map((l) =>
      l.said == 'builder' && l.usage?.input
    ),
    [100, 300],
  )
})

Deno.test('a tool refusal is a line the model can correct', async () => {
  let { env, space } = await seeded()
  let model = fake([
    { calls: [call('c1', 'app_new', { slug: 'Not A Slug', title: 'x' })] },
    { calls: [call('c2', 'nonesuch', {})] },
    { text: 'sorry about that' },
  ])
  let out = await build(env, owner, space, asked('go'), { model })

  assertEquals(out.refused, undefined)
  let said = out.lines.filter((l) => l.said == 'tool').map((l) =>
    l.said == 'tool' ? l.text : ''
  )
  assert(said[0].length > 0, 'the refusal came back as the tool answer')
  assertEquals(said[1], 'no tool nonesuch')
})

Deno.test('the free build has no model bound here, and says so', async () => {
  let { env, space } = await seeded()
  let out = await build(env, owner, free(space), asked('go'))

  assertEquals(out.refused, NO_AI)
  assertStringIncludes(out.text, 'T-34238')
})

Deno.test('the paid build with no key names the ticket that mints one', async () => {
  let { env, space } = await seeded()
  let out = await build(env, owner, { ...space, tier: 'plus' }, asked('go'))

  assertEquals(out.refused, NO_KEY)
  assertStringIncludes(out.text, 'OPENAI_API_KEY')
})

Deno.test('the tier picks the model, and the id picks the provider', async () => {
  let { env, space } = await seeded()
  assertStringIncludes(idOf(env, free(space)), '@cf/')
  assertEquals(idOf(env, { ...space, tier: 'plus' }), 'gpt-5.6-terra')

  // Config overrides both, and a `@cf/` id is Workers AI whoever set it.
  let said = { ...env, BUILDER_MODEL_FREE: '@cf/openai/gpt-oss-120b' }
  assertEquals(idOf(said, free(space)), '@cf/openai/gpt-oss-120b')
  assertEquals(modelOf(env, '@cf/x/y').id, '@cf/x/y')
})

Deno.test('the roster is the platform table, whole', async () => {
  let { env } = await seeded()
  let ctx = {
    env,
    dir: directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true),
    person: ADA,
  }
  let names = roster(ctx).map((t) => t.fn.name)
  for (let want of ['app_new', 'app_files', 'app_deploy', 'member_add']) {
    assert(names.includes(want), `${want} is offered`)
  }
  // Every one of them describes itself, so a model can choose between them.
  for (let t of roster(ctx)) {
    assert(t.fn.description.length > 20, `${t.fn.name} says what it is`)
    assertEquals(t.fn.parameters.type, 'object')
  }
})

// OpenAI's Responses API, stood up on a socket: the gateway is a URL, so
// pointing OPENAI_API at this one drives the whole provider — the request it
// writes and the response it reads — with no key and no account.
let openaiStub = (
  answer: (n: number) => { status?: number; body?: unknown },
) => {
  let heard: { auth: string | null; body: Record<string, unknown> }[] = []
  let server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    heard.push({
      auth: req.headers.get('authorization'),
      body: await req.json(),
    })
    let { status = 200, body = {} } = answer(heard.length)
    return Response.json(body, { status })
  })
  let { port } = server.addr as Deno.NetAddr
  return {
    heard,
    url: `http://127.0.0.1:${port}`,
    stop: () => server.shutdown(),
  }
}

Deno.test('the paid build reaches the gateway with no key of ours', async () => {
  let said = openaiStub(() => ({
    body: {
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'here you go' }],
      }],
      usage: {
        input_tokens: 900,
        output_tokens: 40,
        input_tokens_details: { cached_tokens: 700 },
      },
    },
  }))
  try {
    let { env, space } = await seeded({ OPENAI_API: said.url })
    let out = await build(env, owner, { ...space, tier: 'plus' }, asked('hi'))

    assertEquals(out.refused, undefined)
    assertEquals(out.text, 'here you go')
    assertEquals(out.usage, { input: 900, output: 40, cached: 700 })
    // Nothing of ours paid for it: the gateway's own credits did.
    assertEquals(said.heard[0].auth, null)
    // And the request is the Responses API's, with the tools on it.
    assertEquals(said.heard[0].body.model, 'gpt-5.6-terra')
    assert(Array.isArray(said.heard[0].body.tools))
    assertStringIncludes(String(said.heard[0].body.instructions), 'app_new')
  } finally {
    await said.stop()
  }
})

Deno.test('a busy model is a wait, not a failure', async () => {
  let said = openaiStub(() => ({ status: 429, body: { error: 'slow down' } }))
  try {
    let { env, space } = await seeded({ OPENAI_API: said.url })
    let out = await build(env, owner, { ...space, tier: 'plus' }, asked('hi'))

    assertEquals(out.refused, BUSY)
    assertEquals(out.rounds, 0)
  } finally {
    await said.stop()
  }
})
