// A space's trial round run in its Operator's store: asked of the space's
// providers and paid from its budget, stopped when the budget is spent, its
// people told once it is over, and a member's pick written as theirs.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { mint } from '@yaks/graph'
import type { Model } from '@yaks/model'
import { test } from '@yaks/testing'
import { load } from '@yaks/trial/round'
import type { RoundFile } from '@yaks/trial/skill'
import { directoryOf, stamp } from './directory.ts'
import { monthOf } from './meter.ts'
import { operatorMemory } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { pickTools, publicity, trialRunning } from './operator-trials.ts'
import { platform } from './testing.ts'

let p = platform('operator trials')
let dir = directoryOf(p.env.STORE)

let file: RoundFile = {
  key: 'r1',
  title: 'Shorter pitches',
  skill: 'pitching',
  output: ['headline'],
  using: { provider: 'fake', model: 'fake-1' },
  writers: { task: 'Pitch $case', skilled: 'Follow:\n$skill\nPitch $case' },
  variants: [
    { key: 'now', title: 'As it is', body: 'write long' },
    { key: 'short', title: 'Shorter', body: 'write short', from: 'now' },
  ],
  cases: [{ key: 'bakery', title: 'Bakery', body: 'a bakery' }],
  plan: {
    variants: ['now', 'short'],
    cases: ['bakery'],
    personas: [false],
    paired: true,
  },
}

// A space with `dollars` to spend, its store with the round planned and its
// cap set by the space, and a model at a tenth of a cent a call.
let ran = async (dollars: number) => {
  let eid = mint()
  await stamp(p.env, {
    entities: [{
      entity: { eid },
      space: { slug: 'trials-' + eid, store: eid },
      budget: { dollars },
      starter: { dollars: 0 },
      meter: { month: monthOf(new Date()), models: 0 },
    }],
  })
  let asked: string[] = []
  let price = { input: 1, output: 10 }
  let fake: Model = Object.assign((req: Parameters<Model>[0]) => {
    let text = (req.items[0] as { text: string }).text
    asked.push(text)
    return Promise.resolve({
      id: mint(),
      model: req.model,
      items: [{
        kind: 'assistant' as const,
        text: '```json\n' +
          JSON.stringify({
            headline: text.includes('short') ? 'Short' : 'Long',
          }) + '\n```',
      }],
      usage: { input_tokens: 100, output_tokens: 20 },
    })
  }, {
    // What a provider lists of its model: its window and its price.
    info: (name: string) => Promise.resolve({ name, context: 100_000, price }),
  })
  let store = operatorMemory()
  trialRunning(store, p.env, {
    models: { fake },
    priced: () => Promise.resolve(price),
    provider: 'fake',
    name: 'fake-1',
  })
  let space = { by: eid }
  let { round } = await load(store.g, file, space)
  await store.g.apply([{
    entity: { eid: round },
    capped: { dollars: 1 },
    $actor: space,
  }], { trusted: true })
  await drain(store)
  let written = (await store.g.read('.writing *'))
    .filter((b) => (b.writing as { output?: unknown }).output)
  let [told] = await store.g.read('.notification .deliver *')
  return { store, eid, asked, written, told, round }
}

test("a round is asked of the space's providers and paid from its budget", async () => {
  let { eid, asked, written, told } = await ran(1)
  assertEquals(asked.length, 2)
  assertEquals(written.length, 2)
  let used = (await dir.at(eid))!.meter!.models
  // 100 tokens in at $1 and 20 out at $10 a million, twice.
  assert(Math.abs(used - 0.0006) < 1e-9, String(used))
  assertEquals((told.deliver as { to: string }).to, eid)
  assertStringIncludes(
    String((told.doc as { body: string }).body),
    '“Shorter pitches” ran: 2 of its writers and judges came back, for under a cent.',
  )
})

test('a space whose budget is spent asks nothing, and its people hear why', async () => {
  let { asked, written, told } = await ran(0)
  assertEquals([asked.length, written.length], [0, 0])
  assertStringIncludes(
    String((told.doc as { body: string }).body),
    '2 left unasked, stopped by',
  )
})

test('a pick is the member’s own, and picking again changes it', async () => {
  let { store, round } = await ran(1)
  let person = mint()
  let [pairs, pick] = pickTools(store, person)
  let shown = String(
    (await pairs.run({ round }, undefined) as { text: string }).text,
  )
  assertStringIncludes(shown, 'Pair 1 of 1 (Bakery)')
  assert(!shown.includes('Shorter'), 'a pair never says which variant wrote it')
  for (let chose of ['first', 'second']) {
    await pick.run({ round, pair: 1, chose, why: 'clearer' }, undefined)
  }
  let taps = await store.g.read('.preference *')
  assertEquals(taps.length, 1)
  let [tap] = taps
  assertEquals((tap.created as { by: string }).by, person)
  assertEquals(
    (tap.preference as { chose: string }).chose,
    (tap.preference as { second: string }).second,
  )
  assertStringIncludes(
    String((await pairs.run({ round }, undefined) as { text: string }).text),
    'every pair',
  )
})

test("whoever brings a round's cases hears they go public, on the skill's page once it has one", async () => {
  let { store, eid, round } = await ran(1)
  let [row] = await store.g.get([round])
  let skill = String((row.round as { skill: string }).skill)
  let before = await publicity(dir, p.env, row)
  assertStringIncludes(before, 'once a member picks in this round')
  assertStringIncludes(before, 'if it is ever published')
  await stamp(p.env, {
    entities: [{
      entity: { eid: skill },
      skill: {},
      doc: { title: 'pitching', body: 'Use for pitches.' },
      published: { name: 'pitching-' + eid, version: 1, space: eid },
    }],
  })
  assertStringIncludes(
    await publicity(dir, p.env, row),
    `show on the skill's public page, https://yaks.app/skills/pitching-${eid}`,
  )
})
