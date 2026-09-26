// An app's models, asked through its own store (D-40545): a page writes an
// entry asking for a turn and the answer lands beside it, a typed question is
// answered as an entry of its own, a model calls the commands the app marks
// for it and no others, as the person who asked, a visitor asks only an app
// that opens its models, and the space's allowance moves by what a call cost
// until, past it, the transcript rests on the ceiling's sentence. Workers AI
// is a fake binding here; the directory and the stores are the platform's own.

import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { MODELS, monthOf } from './meter.ts'
import { priceOf, weigh } from './models.ts'
import { parseTools } from './lib/tools.ts'
import type { VocabDoc } from '@yaks/vocab'
import { platform } from './testing.ts'
import { until } from '../../bin/testing.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let FLASH = '@cf/zai-org/glm-5.3-flash'
let JEV = 'typesafe/jev'

type Asked = { model: string; input: Record<string, unknown> }

// A platform with one space, Ada's, holding one app, and Workers AI answering
// each call with what `answer` says. `access` is the app's; `manifest` is its
// vocab.json, deployed as its owner deploys one.
let vale = async (
  answer: (a: Asked, n: number) => unknown,
  { access = 'public', manifest = {} as unknown, models = 0 } = {},
) => {
  let asked: Asked[] = []
  let AI = {
    run: (model: string, input: unknown) => {
      let a = { model, input: input as Record<string, unknown> }
      asked.push(a)
      return Promise.resolve(answer(a, asked.length))
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
        doc: { title: 'Ada' },
        space: { slug: 'ada' },
        ...(models ? { meter: { month: monthOf(new Date()), models } } : {}),
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Vale' },
        app: { space: '$space', slug: 'vale', store: 'ada/vale' },
      },
    ],
  }, { 'x-yak-role': 'owner' })
  let app = (await dir.app((await dir.space('ada'))!, 'vale'))!
  let store = p.env.STORE.get(p.env.STORE.idFromName('ada/vale'))
  let as = (person: string | null) => ({
    'x-store': 'ada/vale',
    'x-yak-app': app.eid,
    'x-yak-access': access,
    ...(person ? { 'x-yak-person': person, 'x-yak-role': 'owner' } : {}),
  })
  let send = (path: string, body: unknown, person: string | null = ADA) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers: as(person),
        body: typeof body == 'string' ? body : JSON.stringify(body),
      }),
    )
  let read = async (q: string): Promise<Bundle[]> =>
    await (await store.fetch(
      new Request(`http://store/query?q=${encodeURIComponent(q)}`, {
        headers: as(ADA),
      }),
    )).json()
  // What a query answers once it answers anything: how a page watching the
  // store sees a reply land.
  let landed = (q: string) =>
    until(async () => {
      let rows = await read(q)
      return rows.length ? rows : null
    }, { label: q })
  // Deployed the way app_deploy deploys: its words, then its commands.
  assertEquals((await send('/vocab', manifest)).status, 200)
  let words = Object.entries((manifest as VocabDoc).$defs ?? {})
    .filter(([, d]) => d.component).map(([name]) => name)
  assertEquals(
    (await send('/tools', parseTools(manifest, words))).status,
    200,
  )
  return {
    asked,
    dir,
    send,
    read,
    landed,
    spent: async () => (await dir.space('ada'))!,
  }
}

// A transcript and the entry that asks it for a turn, as a page writes them.
let asking = (
  session: string,
  model: string,
  more: Record<string, unknown> = {},
): Bundle[] => [
  { entity: { eid: session }, session: {} },
  {
    ...more,
    entity: { eid: crypto.randomUUID() },
    entry: { session },
    content: { body: 'a stranger comes to the forge' },
    using: { model },
  },
]

let said = (b: Bundle) => (b.content as Comp | undefined)?.body

Deno.test('a page asks its store for a turn and the answer lands beside it', async () => {
  let v = await vale(() => ({
    response: 'Welcome, traveller.',
    usage: { prompt_tokens: 1_000, completion_tokens: 100 },
  }))
  let s = crypto.randomUUID()
  assertEquals((await v.send('/apply', asking(s, FLASH))).status, 200)
  let [reply] = await v.landed(`.entry.session=${s}&.output&*`)
  assertEquals(said(reply), 'Welcome, traveller.')
  assertEquals(v.asked.map((a) => a.model), [FLASH])
  // The space paid for it, at the model's price.
  let cost = weigh(priceOf(FLASH)!, { input_tokens: 1_000, output_tokens: 100 })
  await until(async () => (await v.spent()).meter?.models)
  assertAlmostEquals((await v.spent()).meter!.models, cost)
})

Deno.test('a typed question comes back as an answer entry', async () => {
  let plan = {
    type: 'choice',
    choice: 'forge',
    confidence: 0.82,
    probabilities: { forge: 0.82, well: 0.18 },
  }
  let v = await vale(() => ({
    model: 'jev',
    answers: { plan },
    usage: { input_tokens: 380, output_tokens: 45 },
  }))
  let s = crypto.randomUUID()
  let questions = {
    asked: {
      plan: {
        type: 'choice',
        instructions: 'Where does the smith go next?',
        criteria: { forge: 'to work', well: 'to rest' },
      },
    },
  }
  await v.send('/apply', asking(s, JEV, { questions }))
  let [answer] = await v.landed('.answer.question=plan&*')
  let { choice, confidence, probabilities } = answer.answer as Comp
  assertEquals([choice, confidence, probabilities], [
    plan.choice,
    plan.confidence,
    plan.probabilities,
  ])
  assertEquals((answer.entry as Comp).session, s)
  assertEquals(v.asked[0].input.questions, questions.asked)
})

Deno.test('a model calls only the commands marked for it, as the person who asked', async () => {
  let manifest = {
    $defs: {
      mood: {
        component: true,
        type: 'object',
        properties: { feeling: { type: 'string' } },
      },
      set_mood: {
        tool: true,
        model: true,
        description: 'Say how the smith feels',
        input: { feeling: { type: 'string' } },
        apply: { entity: { eid: '$m' }, mood: { feeling: '$feeling' } },
      },
      moods: {
        tool: true,
        description: 'Every mood so far',
        query: '.mood',
      },
    },
  }
  let v = await vale((_, n) =>
    n == 1
      ? {
        response: '',
        tool_calls: [{ name: 'set_mood', arguments: { feeling: 'glad' } }],
      }
      : { response: 'The smith is glad.' }, { manifest })
  let s = crypto.randomUUID()
  await v.send('/apply', asking(s, FLASH))
  await until(
    async () =>
      (await v.read(`.entry.session=${s}&.output&*`)).some((b) =>
        said(b) == 'The smith is glad.'
      ),
    { label: 'the answer after the tool' },
  )
  let offered = v.asked[0].input.tools as { function: { name: string } }[]
  assertEquals(offered.map((t) => t.function.name), ['set_mood'])
  let [mood] = await v.read('.mood&*')
  assertEquals(mood.mood, { feeling: 'glad' })
  assertEquals((mood.created as Comp).by, ADA)
})

Deno.test('a visitor asks an app for a turn only where it opens its models', async () => {
  let answer = () => ({ response: 'hello' })
  let shut = await vale(answer, { access: 'open' })
  let refused = await shut.send(
    '/apply',
    asking(crypto.randomUUID(), FLASH),
    null,
  )
  assertEquals(refused.status, 403)
  assertEquals(shut.asked.length, 0)

  let open = await vale(answer, {
    access: 'open',
    manifest: { models: 'open' },
  })
  let s = crypto.randomUUID()
  assertEquals((await open.send('/apply', asking(s, FLASH), null)).status, 200)
  await until(async () =>
    (await open.read(`.entry.session=${s}&.output&*`)).some(said)
  )
})

Deno.test('a space past its allowance is told so, and the transcript rests', async () => {
  let v = await vale(() => ({ response: 'never' }), { models: MODELS.free })
  let s = crypto.randomUUID()
  await v.send('/apply', asking(s, FLASH))
  let [stopped] = await v.landed(`.entry.session=${s}&.error&*`)
  assertEquals((stopped.error as Comp).code, 'limit')
  assert(String(said(stopped)).includes('of model use a month'))
  assertEquals(v.asked.length, 0)
  let [session] = await v.read(`.eid=${s}&*`)
  assertEquals((session.session as Comp).status, 'failed')
})
