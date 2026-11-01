import { assertAlmostEquals, assertEquals, assertRejects } from '@std/assert'
import { mint } from '@yaks/graph'
import { ModelError } from '@yaks/model'
import { test } from '@yaks/testing'
import type { Ask, Model } from './builder.ts'
import { turn } from './builder-spend.ts'
import { directoryOf, stamp } from './directory.ts'
import { monthOf } from './meter.ts'
import { platform } from './testing.ts'

let p = platform('builder budget')
let dir = directoryOf(p.env.STORE)
let fixture = async () => {
  let eid = mint()
  await stamp(p.env, {
    entities: [{
      entity: { eid },
      space: { slug: 'builder-' + eid, store: eid },
      meter: { month: monthOf(new Date()), models: 0 },
    }],
  })
  return {
    space: (await dir.at(eid))!,
    used: async () => (await dir.at(eid))!.meter!.models,
  }
}
let fresh = await fixture()
let writes = await fixture()
let replay = await fixture()
let ambiguous = await fixture()
let ask: Ask = { system: '', said: [], fns: [], tokens: 4096 }
let model = (run: Model['ask']): Model => ({
  id: 'bounded',
  context: 0,
  price: { input: 0, output: 1000 },
  ask: run,
})

test('builder turns use fresh provider pricing and context before granting output', async () => {
  let tokens = 0
  let m = model(async (a) => {
    await a.onSubmit!()
    tokens = a.tokens
    return { text: '', calls: [], usage: { input: 10, output: a.tokens } }
  })
  m.price = { input: 0, output: 0 }
  m.info = () =>
    Promise.resolve({
      name: m.id,
      context: 10,
      price: { input: 1000, output: 1000 },
    })
  await turn(p.env, fresh.space, m, ask)
  assertEquals(tokens, 190)
  assertAlmostEquals(await fresh.used(), 0.2)
})

test('unreported builder cache categories retain the highest possible input charge', async () => {
  let m = model(async (a) => {
    await a.onSubmit!()
    return { text: '', calls: [], usage: { input: 100, output: 0 } }
  })
  m.context = 100
  m.price = { input: 1, output: 0, cache_write: 1000 }
  await turn(p.env, writes.space, m, ask)
  assertAlmostEquals(await writes.used(), 0.1)
})

test('one builder reservation permits one paid submission', async () => {
  let sent = 0
  let m = model(async (a) => {
    await a.onSubmit!()
    sent++
    await a.onSubmit!()
    sent++
    return { text: '', calls: [], usage: {} }
  })
  await assertRejects(
    () => turn(p.env, replay.space, m, ask),
    ModelError,
    'already spent',
  )
  assertEquals(sent, 1)
  assertAlmostEquals(await replay.used(), 0.2)
})

test('a busy failure after builder submission keeps uncertain dollars reserved', async () => {
  let m = model(async (a) => {
    await a.onSubmit!()
    throw new ModelError('busy', 'uncertain paid response')
  })
  await assertRejects(() => turn(p.env, ambiguous.space, m, ask), ModelError)
  assertAlmostEquals(await ambiguous.used(), 0.2)
})
