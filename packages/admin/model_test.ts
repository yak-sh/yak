import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { ram } from '@yaks/ram'
import { loadVocab, pick } from '@yaks/vocab'
import { listPrice } from '@yaks/model'
import { modelDoc } from '@yaks/model/vocab'
import { CallError } from '@yaks/tools/errors'
import { modelLine, operatorModel, operatorRows } from './model.ts'

let vocab = loadVocab([pick(modelDoc, ['model', 'price'])])
let box = graph({ storage: ram(vocab), vocab })
let eid = (name: string) => identityEid('model', [name])
await box.apply([
  {
    entity: { eid: eid('gpt-6.1-sol') },
    model: { name: 'gpt-6.1-sol', vendor: 'openai', context: 500000 },
  },
  {
    entity: { eid: eid('claude-opus-5-5') },
    model: { name: 'claude-opus-5-5', context: 1000000, offered: true },
    price: { input: 5, output: 25 },
  },
  { entity: { eid: eid('unpriced') }, model: { name: 'unpriced' } },
])
// The directory, as the rows the tool writes there.
let directory = (rows: Bundle[]) => ({
  get: (eids: string[]) =>
    Promise.resolve(rows.filter((b) => eids.includes(b.entity.eid))),
})
let choose = async (named: string, provider?: string) => {
  let rows = await operatorRows(box, named, provider)
  await box.apply(rows.box)
  return modelLine(await operatorModel(directory(rows.directory)))
}

test('a model the box prices is named whole, on the provider given', async () => {
  assertEquals(
    await choose('claude-opus-5-5', 'anthropic'),
    'claude-opus-5-5 on anthropic, $5 in, $25 out per million tokens, a window of 1,000,000',
  )
})

test('a model with no price on the box takes its list price there first, on its vendor', async () => {
  let { input, output } = listPrice('gpt-6.1-sol')!
  assertEquals(
    await choose('gpt-6.1-sol'),
    `gpt-6.1-sol on openai, $${input} in, $${output} out per million tokens, a window of 500,000`,
  )
  let [row] = await box.get([eid('gpt-6.1-sol')])
  assertEquals(row.price, listPrice('gpt-6.1-sol'))
})

test('a model the box does not hold, or cannot price, is refused', async () => {
  await assertRejects(() => operatorRows(box, 'nothing', 'openai'), CallError)
  await assertRejects(() => operatorRows(box, 'unpriced', 'openai'), CallError)
})

test('a directory that names no model says so', () => {
  assertEquals(
    modelLine(undefined).startsWith('The directory names no model'),
    true,
  )
})
