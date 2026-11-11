import { equal, test } from '@yaks/testing'
import type { Bundle, Graph } from '@yaks/graph'
import { bearing, earlier, ownWords } from './earlier.ts'

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
  equal(
    ownWords(
      {
        ...quote,
        doc: { body: 'test the other number' },
        created: input.created,
      },
      'person',
      'Ada',
    )[0].words,
    'test the other number',
  )
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
let recall = (floor?: number) =>
  earlier({
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
    floor,
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
          ? [{ entity: 'd', similarity: .78, excerpt: '' }]
          : [{ entity: 'input', similarity: .9, excerpt: '' }],
      )
    },
  })
let beside = await recall()
test('the nearest memories and answered decisions ride beside the words, by id and title, without repeating a quote', () => {
  equal(
    beside.split('\n\n')[1],
    'Nearest memories and decisions (read one by id before relying on it):\n' +
      'M-7 · Attachments are immutable files\n' +
      'D-9 · Where do attachments live? → blobs',
  )
  equal(asked.some((w) => w.includes('!quarantined')), true)
})
test('a floor keeps only the memories and decisions at least that near', async () => {
  equal(
    (await recall(.79)).split('\n\n')[1],
    'Nearest memories and decisions (read one by id before relying on it):\n' +
      'M-7 · Attachments are immutable files',
  )
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

// What an agent wrote, and what the person said and decided near it.
let own: Bundle = {
  entity: { eid: 'own' },
  comment: { target: 't' },
  doc: { body: 'test with the other number' },
  created: { by: 'person', at: '2026-01-03T00:00:00Z', via: 'web' },
}
let told: Bundle = {
  ...input,
  entity: { eid: 'told' },
  entry: { session: 'agent' },
  content: { body: 'forward texts to email' },
  created: { by: 'person', at: '2026-01-04T00:00:00Z' },
}
let near = [input, own, told, ...kept]
let bears = (
  sims: Record<string, number>,
  rest: Partial<Parameters<typeof bearing>[1]> = {},
) =>
  bearing({
    ...g,
    get: (ids: string[]) =>
      Promise.resolve(near.filter((b) => ids.includes(b.entity.eid))),
  } as unknown as Graph, {
    person: 'person',
    name: 'Ada',
    words: 'Text the church line\nA reply proves texts arrive',
    before: '2026-02-01T00:00:00Z',
    meaning: (_, opts) =>
      Promise.resolve(
        (opts?.within?.includes('.decision') ? ['d'] : ['own', 'told', 'input'])
          .map((entity) => ({
            entity,
            similarity: sims[entity] ?? 0,
            excerpt: '',
          })),
      ),
    ...rest,
  })
let ids = async (found: ReturnType<typeof bearing>) => {
  let { said, decided } = await found
  return [...said.map((q) => q.id), ...decided.map((b) => b.entity.eid)]
}
test("what an agent wrote is answered with the person's nearest words and answered decisions, nearest first", async () => {
  let found = await bears({ own: .9, told: .85, input: .5, d: .8 })
  equal(found.said.map((q) => [q.id, q.words]), [
    ['#own', 'test with the other number'],
    ['#told', 'forward texts to email'],
  ])
  equal(found.decided.map((b) => b.entity.eid), ['d'])
})
test('words and decisions that are not near what was written do not arrive', async () => {
  equal(await ids(bears({ own: .7, told: .7, input: .7, d: .7 })), [])
  equal(await ids(bears({ own: .7, d: .7 }, { floor: .6 })), ['#own'])
})
test('what the writing session was told since its compaction is left out', async () => {
  let sims = { own: .9, told: .9 }
  equal(await ids(bears(sims, { held: { via: 'agent' } })), ['#own'])
  equal(
    await ids(
      bears(sims, { held: { via: 'agent', since: '2026-01-05T00:00:00Z' } }),
    ),
    ['#own', '#told'],
  )
})
test('with no meaning index, or past its wait, nothing bears', async () => {
  equal(await ids(bears({ own: .9 }, { meaning: undefined })), [])
  let slow = bears({ own: .9 }, {
    wait: 5,
    meaning: () => new Promise((done) => setTimeout(done, 40, [])),
  })
  equal(await ids(slow), [])
  await new Promise((done) => setTimeout(done, 45))
})
