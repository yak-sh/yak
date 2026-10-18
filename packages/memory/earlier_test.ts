import { equal, test } from '@yaks/testing'
import type { Bundle, Graph } from '@yaks/graph'
import { earlier, ownWords } from './earlier.ts'

let input: Bundle = {
  entity: { eid: 'input' },
  entry: { session: 's' },
  content: { body: 'use immutable files for attachments' },
  created: { by: 'person', at: '2026-01-01T10:00:00Z' },
}
let quote: Bundle = {
  entity: { eid: 'quote' },
  comment: { target: 't' },
  doc: {
    body: 'Ada, 2026-01-01, verbatim: "use immutable files for attachments"',
  },
  created: { by: 'agent', at: '2026-01-02T00:00:00Z' },
}
test('earlier words keep authored text and strip only an explicit quote wrapper', () => {
  equal(
    ownWords(input, 'person', 'Ada')[0].words,
    'use immutable files for attachments',
  )
  equal(
    ownWords(quote, 'person', 'Ada')[0].words,
    'use immutable files for attachments',
  )
  equal(
    ownWords(
      { ...quote, doc: { body: 'Ada wants immutable files' } },
      'person',
      'Ada',
    ),
    [],
  )
  equal(ownWords({ ...input, output: { source: 'ask' } }, 'person', 'Ada'), [])
  equal(ownWords(input, 'other', 'Ada'), [])
})
let rows = [input, quote, {
  ...input,
  entity: { eid: 'later' },
  created: { by: 'person', at: '2027-01-01T00:00:00Z' },
  content: { body: 'later answer' },
}]
let g = {
  vocab: { comp: () => ({}) },
  read: () => Promise.resolve(rows),
  get: () => Promise.resolve(rows),
} as unknown as Graph
let recalled = await earlier(g, {
  person: 'person',
  name: 'Ada',
  words: 'attachments',
  before: '2026-02-01T00:00:00Z',
})
test('recall excludes later words and deduplicates verbatim copies', () => {
  equal(recalled.includes('input ·'), true)
  equal(recalled.includes('quote ·'), false)
  equal(recalled.includes('later answer'), false)
})
test('an unknown person and an empty prompt do not search', async () => {
  equal(
    await earlier(g, { words: 'attachments', before: '2026-02-01T00:00:00Z' }),
    '',
  )
  equal(
    await earlier(g, {
      person: 'person',
      name: 'Ada',
      words: '',
      before: '2026-02-01T00:00:00Z',
    }),
    '',
  )
})

test('a late quote cannot backdate itself into earlier evidence', async () => {
  let late = { ...quote, created: { at: '2026-03-01T00:00:00Z' } }
  let graph = { ...g, read: () => Promise.resolve([late]) } as Graph
  equal(
    await earlier(graph, {
      person: 'person',
      name: 'Ada',
      words: 'immutable files',
      before: '2026-02-01T00:00:00Z',
    }),
    '',
  )
})
test('a quote in agent prose is not a person-authored input', () => {
  equal(
    ownWords(
      { ...input, created: { by: 'agent', at: '2026-01-01T00:00:00Z' } },
      'person',
      'Ada',
    ),
    [],
  )
})
