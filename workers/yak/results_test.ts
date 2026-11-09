import { equal, ok, test } from '@yaks/testing'
import { operatorMemory } from './operator-testing.ts'
import { keepResult, readResult, resultValue } from './results.ts'
import { RESULT_LIMIT, resultBytes, resultSummary } from '@yaks/context/result'
import { queryResult } from './result-query.ts'

let { g } = operatorMemory()
let person = crypto.randomUUID()
let source = { entity: { eid: crypto.randomUUID() } }
let data = Array.from({ length: 100 }, (_, id) => ({
  id,
  name: 'row ' + id,
  body: '🦦'.repeat(500),
}))
let summary = await keepResult(g, { result: data }, source, person)
let narrowed = await queryResult(
  g,
  summary.id,
  '.result | map(select(.id >= 98) | {id, name})',
  source,
  person,
)
let repeated = await queryResult(g, summary.id, '.', source, person)
let answer = [{
  entity: source.entity,
  content: { body: 'z'.repeat(300_000) },
  output: { value: { total: 100 } },
}]
let prose = await keepResult(
  g,
  resultValue(answer, {
    name: 'sample',
    description: 'A sample',
    outputSchema: { type: 'object' },
    run: () => [],
  }),
  source,
  person,
)

test('large results retain all Unicode data and describe the shape with a bounded preview', async () => {
  equal(summary.bytes, resultBytes({ result: data }))
  equal(summary.shape, {
    type: 'object',
    keys: ['result'],
    rows: 100,
    path: '.result',
    columns: ['id', 'name', 'body'],
  })
  ok(resultBytes(summary) < RESULT_LIMIT)
  equal(await readResult(g, summary.id, person), { result: data })
})

test('jq narrows kept data and returns full query outputs to programs', () => {
  equal(narrowed, {
    values: [[{ id: 98, name: 'row 98' }, { id: 99, name: 'row 99' }]],
  })
  equal(repeated, { values: [{ result: data }] })
})

test('a kept result is private to the reader who produced it', async () => {
  let error
  try {
    await readResult(g, summary.id, crypto.randomUUID())
  } catch (e) {
    error = e
  }
  ok(error)
})

test('retained custom answers preserve all accompanying prose', async () => {
  ok(prose)
  equal(await readResult(g, prose!.id, person), {
    structuredContent: { total: 100 },
    content: [{ type: 'text', text: 'z'.repeat(300_000) }],
  })
})

test('nested cells and long keys cannot expand the model summary beyond its budget', () => {
  let value: unknown = { ['key'.repeat(30_000)]: 'x'.repeat(100_000) }
  for (let i = 0; i < 8; i++) value = [value, value, value, value]
  ok(resultBytes(resultSummary('sample', value, 100_000)) < RESULT_LIMIT)
  let wide = Array.from({ length: 3 }, () =>
    Object.fromEntries(
      Array.from(
        { length: 30 },
        (_, i) => [i + '界'.repeat(200), '界'.repeat(1000)],
      ),
    ))
  ok(resultBytes(resultSummary('wide', wide, 100_000)) < RESULT_LIMIT)
})

test('custom answer keys survive accompanying text and image content', () => {
  let images = [{ data: 'full-image-bytes', mime_type: 'image/png' }]
  let value = {
    count: 1,
    said: 'Structured prose',
    images: ['Structured image'],
  }
  equal(
    resultValue([{
      entity: source.entity,
      content: { body: 'An image' },
      output: { value, images },
    }], {
      name: 'image',
      description: 'Image',
      outputSchema: { type: 'object' },
      run: () => [],
    }),
    {
      structuredContent: value,
      content: [{ type: 'text', text: 'An image' }],
      images,
    },
  )
})
