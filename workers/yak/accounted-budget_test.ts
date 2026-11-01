import { assertAlmostEquals, assertEquals, assertRejects } from '@std/assert'
import { mint } from '@yaks/graph'
import { type Model, ModelError } from '@yaks/model'
import { test } from '@yaks/testing'
import { directoryOf, stamp } from './directory.ts'
import { accounted, metered, monthOf } from './meter.ts'
import { platform } from './testing.ts'
import { reservation, settled } from './model-spend.ts'

let p = platform('accounted budget')
let dir = directoryOf(p.env.STORE)
let fixture = async (models = 0) => {
  let eid = mint()
  await stamp(p.env, {
    entities: [{
      entity: { eid },
      space: { slug: 'budget-' + eid, store: eid },
      meter: { month: monthOf(new Date()), models },
    }],
  })
  return {
    space: (await dir.at(eid))!,
    used: async () => (await dir.at(eid))!.meter!.models,
  }
}
let boundary = await fixture(0.1985)
let failed = await fixture()
let prepared = await fixture()
let unknown = await fixture()
let over = await fixture()
let req = { model: 'bounded', items: [], tools: [], tokens: 2000 }
let info = () =>
  Promise.resolve({
    name: 'bounded',
    context: 1000,
    price: { input: 1, output: 1 },
  })
let withModel = (space: typeof boundary.space, raw: Model) =>
  accounted(p.env, () => Promise.resolve(space), raw)

let rejected = await fixture()
let checkpoint = await fixture()
let question = await fixture(0.1985)
let rawQuestion = await fixture(0.199985)
let rawBoundary = await fixture(0.19995)
let batch = await fixture(0.19975)
let nested = await fixture()
let binding = (
  space: typeof boundary.space,
  output: number,
  context: number,
) => {
  let asked: Record<string, unknown>[] = []
  let ai = metered({
    STORE: p.env.STORE,
    MODEL_FETCH: () =>
      Promise.resolve(
        new Response(
          `Context Window | ${context} tokens\nUnit Pricing | $1 per M input tokens, $${output} per M output tokens`,
        ),
      ),
    AI: {
      run: (_model, input) => {
        let body = input as Record<string, unknown>
        asked.push(body)
        return Promise.resolve({
          usage: {
            input_tokens: context * Number(body.n ?? 1),
            output_tokens: Number(body.max_tokens ?? 0) * Number(body.n ?? 1),
          },
        })
      },
    },
  }, () => Promise.resolve(space))
  return {
    asked,
    run: (input: Record<string, unknown>) => ai.run('@cf/bounded', input),
  }
}
let choices = binding(rawBoundary.space, 1, 10)
let embeds = binding(batch.space, 0, 100)
let requests = binding(nested.space, 1, 10)
let questions = binding(rawQuestion.space, 1, 10)

test('hosted provider gets an affordable output cap before its paid call', async () => {
  let seen = 0
  let raw: Model = Object.assign(async (ask: Parameters<Model>[0]) => {
    seen++
    assertEquals(ask.tokens! <= 500, true)
    await ask.onSubmit!()
    return {
      id: 'answer',
      model: ask.model,
      items: [],
      usage: { input_tokens: 1000, output_tokens: ask.tokens },
    }
  }, { info })
  let model = withModel(boundary.space, raw)
  await model(req)
  assertEquals(await boundary.used() <= 0.2, true)
  await assertRejects(() => model(req), ModelError)
  assertEquals(seen, 1)
})

test('an ambiguous paid provider failure retains the reservation for recovery', async () => {
  let call = mint()
  let raw: Model = Object.assign(async (ask: Parameters<Model>[0]) => {
    await ask.onSubmit!()
    throw new Error('transport lost after submit')
  }, { info })
  await assertRejects(
    () => withModel(failed.space, raw)({ ...req, call }),
    Error,
    'transport lost',
  )
  assertAlmostEquals(await failed.used(), 0.003)
  assertEquals((await reservation(p.env, call))!.dollars, 0.003)
  await settled(p.env, call, 0.0015)
  assertAlmostEquals(await failed.used(), 0.0015)
})

test('a provider preparation refusal releases its unsubmitted reservation', async () => {
  let raw: Model = Object.assign(
    () => Promise.reject(new ModelError('input', 'bad input')),
    { info },
  )
  await assertRejects(() => withModel(prepared.space, raw)(req), ModelError)
  assertAlmostEquals(await prepared.used(), 0)
})

test('missing provider token counts retain the conservative call charge', async () => {
  let raw: Model = Object.assign(async (ask: Parameters<Model>[0]) => {
    await ask.onSubmit!()
    return {
      id: 'unknown',
      model: ask.model,
      items: [],
      usage: { input_tokens: 1 },
    }
  }, { info })
  await withModel(unknown.space, raw)(req)
  assertAlmostEquals(await unknown.used(), 0.003)
})

test('a provider violating its quote is surfaced without freeing held dollars', async () => {
  let raw: Model = Object.assign(async (ask: Parameters<Model>[0]) => {
    await ask.onSubmit!()
    return { id: 'over', model: ask.model, items: [], cost: 0.004 }
  }, { info })
  await assertRejects(
    () => withModel(over.space, raw)(req),
    Error,
    'exceeded its reserved maximum',
  )
  assertAlmostEquals(await over.used(), 0.003)
})

test('raw multiple choices and completion-token aliases share one affordable bound', async () => {
  await choices.run({ n: 2, max_tokens: 1000, max_completion_tokens: 1000 })
  assertEquals(choices.asked.length, 1)
  let input = choices.asked[0]
  assertEquals(input.max_tokens, input.max_completion_tokens)
  assertEquals(Number(input.max_tokens) <= 15, true)
  assertEquals(await rawBoundary.used() <= 0.2, true)
})

test('an embedding batch reserves the context bound for every text', async () => {
  await assertRejects(
    () => embeds.run({ text: ['one', 'two', 'three'] }),
    ModelError,
  )
  assertEquals(embeds.asked.length, 0)
  assertAlmostEquals(await batch.used(), 0.19975)
})

test('an unbounded nested raw request batch is refused before purchase', async () => {
  await assertRejects(
    () => requests.run({ requests: [{ messages: [], max_tokens: 100_000 }] }),
    ModelError,
  )
  assertEquals(requests.asked.length, 0)
  assertEquals(await nested.used(), 0)
})

test('a media checkpoint keeps the maximum until the final cost settles', async () => {
  let raw: Model = Object.assign(async (ask: Parameters<Model>[0]) => {
    await ask.onSubmit!()
    await ask.onMedia!({
      call: ask.call!,
      id: 'media',
      model: ask.model,
      input: {},
      response: {},
      cost: 0.001,
    })
    return { id: 'final', model: ask.model, items: [], cost: 0.002 }
  }, { info })
  let seen = 0
  await withModel(checkpoint.space, raw)({
    ...req,
    onMedia: async () => {
      seen++
      assertAlmostEquals(await checkpoint.used(), 0.003)
    },
  })
  assertEquals(seen, 1)
  assertAlmostEquals(await checkpoint.used(), 0.002)
})

test('structured questions cannot rely on an output cap their binding ignores', async () => {
  let seen = 0
  let raw: Model = Object.assign(() => {
    seen++
    return Promise.reject(new Error('must not buy'))
  }, { info })
  await assertRejects(
    () => withModel(question.space, raw)({ ...req, tokens: 1, questions: {} }),
    ModelError,
  )
  await assertRejects(
    () => questions.run({ state: [], questions: {}, max_tokens: 1 }),
    ModelError,
  )
  assertEquals(seen, 0)
  assertEquals(questions.asked.length, 0)
})

test('an explicit Workers AI input refusal refunds the unpurchased call', async () => {
  let ai = metered({
    STORE: p.env.STORE,
    MODEL_FETCH: () =>
      Promise.resolve(
        new Response(
          'Context Window | 100 tokens\nUnit Pricing | $1 per M input tokens, $1 per M output tokens',
        ),
      ),
    AI: {
      run: () => Promise.reject(new Error("5006: Error: oneOf at '/' not met")),
    },
  }, () => Promise.resolve(rejected.space))
  await assertRejects(() => ai.run('@cf/refusing', {}), Error, '5006:')
  assertAlmostEquals(await rejected.used(), 0)
})
