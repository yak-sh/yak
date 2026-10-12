// Hosts can hold a graph to its explicit declarations and keyword vocabulary.
import { equal, test, throws } from '@yaks/testing'
import { type Taken, wordsOf } from './words.ts'
import type { VocabDoc } from '@yaks/vocab'
let facets: Taken<'vocab'> = [[
  {
    docs: [{
      $defs: {
        record: {
          component: true,
          type: 'object',
          prefix: 'R',
          properties: { value: { type: 'string' } },
        },
      },
    }],
  },
  {},
  'records',
]]
let exact = { implicit: false, keywords: [] }
test('explicit host words refuse paths outside their configured vocabulary', async () => {
  let v = wordsOf(facets, undefined, exact).vocab
  equal(v.aim('record.value')[0].prop, 'value')
  await throws(() => v.aim('commit.target'), 'commit')
  equal(wordsOf(facets).vocab.aim('commit.target')[0].prop, 'target')
  equal(v.comp('record')?.keywords.prefix, undefined)
  equal(wordsOf(facets).vocab.comp('record')?.keywords.prefix, 'R')
  equal(wordsOf(facets, undefined, exact).vocab, v)
})

test('decoded vocabularies share their compilation across different graph declarations', () => {
  let docs = (type = 'string'): VocabDoc[] => [{
    $defs: {
      note: { component: true, properties: { text: { type } } },
    },
  }]
  let first = wordsOf(facets, docs()).vocab
  let changed = wordsOf(facets, docs('integer')).vocab
  equal(wordsOf(facets, docs()).vocab, first)
  equal(changed.prop('note', 'text')?.scalar, 'number')
  equal(first.prop('note', 'text')?.affinity, 'text')
})
