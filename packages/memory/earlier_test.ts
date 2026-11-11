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
let vocab = {
  comp: () => ({}),
  all: [],
  kindOf: (b: Bundle) =>
    b.memory ? 'memory' : b.decision ? 'decision' : 'entry',
}
let g = {
  vocab,
  read: () => Promise.resolve(rows),
  get: () => Promise.resolve(rows),
} as unknown as Graph
let recalled = await earlier(g, {
  person: 'person',
  name: 'Ada',
  words: 'attachments files',
  before: '2026-02-01T00:00:00Z',
})
test('recall excludes later words and deduplicates verbatim copies', () => {
  equal(recalled.includes('#input · 2026-01-01 ·'), true)
  equal(recalled.includes('#quote ·'), false)
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

let lexicalReads = 0
let semanticAnswer = await earlier({
  ...g,
  read: () => {
    lexicalReads++
    throw Error('semantic answer must not scan lexical corpus')
  },
} as Graph, {
  person: 'person',
  name: 'Ada',
  words: 'immutable attachments',
  before: '2026-02-01T00:00:00Z',
  meaning: () =>
    Promise.resolve([{ entity: 'input', similarity: .9, excerpt: '' }]),
})
test('semantic recall does not duplicate its work with a lexical corpus scan', () => {
  equal(lexicalReads, 0)
  equal(semanticAnswer.includes('immutable files'), true)
})
let termQueries: string[] = []
let fallbackAnswer = await earlier({
  ...g,
  read: (q: unknown) => {
    termQueries.push(String(q))
    return Promise.resolve([input])
  },
} as Graph, {
  person: 'person',
  name: 'Ada',
  words: 'immutable attachments files',
  before: '2026-02-01T00:00:00Z',
})
test('lexical fallback searches bounded individual terms and deduplicates their quotes', () => {
  equal(termQueries.length, 3)
  equal(termQueries.every((q) => !q.includes('"|"')), true)
  equal(fallbackAnswer.split('input ·').length, 2)
})

let kept: Bundle[] = [{
  entity: { eid: 'm', num: 7 },
  memory: {},
  doc: { title: 'Attachments are immutable files' },
}, {
  entity: { eid: 'd', num: 9 },
  decision: {},
  decided: { choice: 'blobs' },
  doc: { title: 'Where do attachments live?' },
}, { entity: { eid: 'far', num: 3 }, memory: {}, doc: { title: 'Unrelated' } }]
let asked: string[] = []
let beside = await earlier({
  ...g,
  read: () => Promise.resolve([]),
  get: (ids: string[]) =>
    Promise.resolve(
      [...rows, ...kept].filter((b) => ids.includes(b.entity.eid)),
    ),
} as unknown as Graph, {
  person: 'person',
  name: 'Ada',
  words: 'where should attachment files live',
  before: '2026-02-01T00:00:00Z',
  meaning: (_, opts) => {
    asked.push(opts?.within ?? '')
    let within = opts?.within ?? ''
    return Promise.resolve(
      within.includes('.memory')
        ? [
          { entity: 'input', similarity: .9, excerpt: '' },
          { entity: 'm', similarity: .8, excerpt: '' },
          { entity: 'far', similarity: .3, excerpt: '' },
        ]
        : within.includes('.decision')
        ? [{ entity: 'd', similarity: .7, excerpt: '' }]
        : [{ entity: 'input', similarity: .9, excerpt: '' }],
    )
  },
})
test('the nearest memories and answered decisions ride beside the words, by id and title, without repeating a quote', () => {
  equal(
    beside.split('\n\n')[1],
    'Nearest memories and decisions (read one by id before relying on it):\n' +
      'M-7 · Attachments are immutable files\n' +
      'D-9 · Where do attachments live? → blobs',
  )
  equal(asked.some((w) => w.includes('!quarantined')), true)
})
test('a long quotation is cut at a line and says so', async () => {
  let long = 'attachment files '.repeat(40)
  let said = await earlier({
    ...g,
    read: () => Promise.resolve([{ ...input, content: { body: long } }]),
  } as Graph, {
    person: 'person',
    name: 'Ada',
    words: 'attachment files',
    before: '2026-02-01T00:00:00Z',
  })
  equal(said.split('\n')[1].endsWith('…"'), true)
  equal(said.length < 400, true)
})
test('a prompt that names no subject recalls nothing', async () => {
  for (let words of ['going afk', 'yes']) {
    equal(
      await earlier(g, {
        person: 'person',
        name: 'Ada',
        words,
        before: '2026-02-01T00:00:00Z',
        meaning: () =>
          Promise.resolve([{ entity: 'input', similarity: .9, excerpt: '' }]),
      }),
      '',
    )
  }
})
