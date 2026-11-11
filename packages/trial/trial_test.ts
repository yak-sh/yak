// One synthetic session, scored case by case: which doors count as in front
// of the agent, what the moment cuts off, and what a search finds.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { docDoc } from '@yaks/doc'
import { personaDoc } from '@yaks/persona'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { memoryDoc } from '@yaks/memory/vocab'
import { tally, trialDoc } from './mod.ts'
import { type Arrival, asking, before, cases, run, WORDS } from './moment.ts'
import {
  carried,
  drafted,
  naming,
  open,
  said as saidBefore,
  standing,
  theirs,
} from './arrive.ts'

let obj = { component: true, type: 'object' }
let props = (p: Record<string, string>) => ({
  ...obj,
  properties: Object.fromEntries(
    Object.entries(p).map(([k, type]) => [k, { type }]),
  ),
})
let vocab = loadVocab([edgeDoc, docDoc, personaDoc, memoryDoc, trialDoc, {
  $defs: {
    contains: { ...obj, edge: true },
    content: props({ body: 'string' }),
    created: props({ at: 'string', by: 'string', via: 'string' }),
    comment: props({ target: 'string' }),
    completed: props({ at: 'string' }),
    notified: props({ at: 'string', via: 'string' }),
    task: { ...obj, status: { completed: 'done', default: 'open' } },
    filed: props({ assignee: 'string' }),
    decision: obj,
    decided: props({ at: 'string', by: 'string', choice: 'string' }),
    session: props({ persona: 'string' }),
    spawned: props({ parent: 'string' }),
    entry: props({ session: 'string', seq: 'number' }),
    checkpoint: obj,
    notice: obj,
    output: obj,
    result: obj,
  },
}], [edgeKeywords])

// Entry n is written at 11:1n, so the erring e7 stands at 11:17.
let T = '2026-11-10T12:00:00.000Z'
let early = '2026-11-10T11:00:00.000Z'
let late = '2026-11-10T13:00:00.000Z'
let at = (when: string) => ({ created: { at: when } })
let doc = (eid: string, when = early, more: Record<string, unknown> = {}) => ({
  entity: { eid },
  doc: { title: eid, body: `about ${eid}` },
  ...at(when),
  ...more,
})
let entry = (
  seq: number,
  body: string,
  kind: Record<string, unknown> = {},
) => ({
  entity: { eid: `e${seq}` },
  entry: { session: 's', seq },
  content: { body },
  ...at(`2026-11-10T11:${String(10 + seq).padStart(2, '0')}:00.000Z`),
  ...kind,
})
// Words someone wrote to the agent: an entry with an author.
let said = (seq: number, body: string) => {
  let e = entry(seq, body)
  return { ...e, created: { ...e.created, by: 'jeff' } }
}
let hitRow = (eid: string) =>
  JSON.stringify({
    result: [{ entity: { eid }, hit: { id: eid, near: 'new' } }],
  })

let g = graph({ storage: ram(vocab), vocab })
await g.apply([
  {
    entity: { eid: 'p' },
    persona: {},
    doc: { title: 'P', body: 'be good' },
    ...at(early),
  },
  doc('m'),
  doc('later', late),
  doc('fresh'),
  { ...link('p', 'contains', 'm'), ...at(early) },
  { ...link('p', 'contains', 'fresh'), ...at(late) },
  doc('knocked', early, {
    notified: { via: 's', at: '2026-11-10T11:15:00.000Z' },
  }),
  doc('tardy', early, { notified: { via: 's', at: late } }),
  doc('hidden'),
  doc('found'),
  ...['x1', 'x2', 'x3', 'x4'].map((x) => doc(x)),
  { entity: { eid: 's' }, session: { persona: 'p' }, ...at(early) },
  entry(1, 'old notice', { notice: {} }),
  entry(2, 'summary', { checkpoint: {} }),
  said(3, 'how do I pay'),
  entry(4, 'pace notice', { notice: {} }),
  entry(5, hitRow('hidden'), { result: {} }),
  entry(
    6,
    JSON.stringify({ result: [{ entity: { eid: 'nearless' }, hit: {} }] }),
    { result: {} },
  ),
  entry(7, 'wrong answer', { output: {} }),
  entry(8, 'later notice', { notice: {} }),
])

// A search that answers the same ranking whatever it is asked, as long as it
// is asked the words the agent was answering.
let ranking = ['later', 'x1', 'x2', 'x3', 'x4', 'found', 'm']
let asked: string[] = []
let search = (words: string) => {
  asked.push(words)
  return ranking.map((eid) => ({ entity: { eid } }))
}

let score = async (needed?: string) =>
  (await run(g.storage, vocab, search, { eid: 'c', entry: 'e7', needed }))
    ?.trial as Record<string, unknown>

let cases_ = [
  ['m', 'in the persona at the moment', true, false],
  ['fresh', 'linked to the persona after the moment', false, false],
  ['knocked', 'a knock delivered before', true, false],
  ['tardy', 'a knock delivered after', false, false],
  ['hidden', 'a hit row a write returned', true, false],
  ['nearless', 'a search hit, which was asked for', false, false],
  ['e4', 'a notice since the compaction', true, false],
  ['e1', 'a notice before the compaction', false, false],
  ['e2', 'the compaction summary', true, false],
  ['e8', 'a notice after the entry', false, false],
  ['found', 'fifth among the rows that predate the entry', false, true],
  [undefined, 'nothing held it', false, false],
] as const

for (let [needed, what, unasked, found] of cases_) {
  test(`trial: ${what}`, async () => {
    let t = await score(needed)
    assertEquals([t.unasked, t.asked], [unasked, found])
    assertEquals(t.variant, 'p')
  })
}

test('trial: the search is asked the words someone last wrote to the agent', async () => {
  asked.length = 0
  await score('m')
  assertEquals(asked, ['how do I pay'])
})

test('trial: a status reads from the marks stamped before the moment', () => {
  let task = {
    entity: { eid: 't' },
    task: { status: 'done' },
    completed: { at: late },
    ...at(early),
  }
  assertEquals((before(vocab, T)(task) as Bundle).task, { status: 'open' })
  assertEquals(before(vocab, T)({ ...task, ...at(late) }), undefined)
})

test('trial: the cases are the misses, and their tally', async () => {
  await g.apply([
    { entity: { eid: 'c1' }, miss: { entry: 'e7', needed: 'm' }, ...at(late) },
    { entity: { eid: 'c2' }, miss: { entry: 'e7' }, ...at(late) },
  ])
  let all = await cases(g.storage)
  let rows = await Promise.all(all.map((c) => run(g.storage, vocab, search, c)))
  await g.apply(rows as Bundle[])
  let tokens = (rows[0]?.trial as { tokens: number }).tokens
  assertEquals(tally(await g.read('.trial'), all), {
    cases: 2,
    held: 1,
    unasked: 1,
    asked: 0,
    tokens,
  })
})

test('trial: the search is asked a phrase, the first words of a long message', () => {
  let long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(', ')
  assertEquals(asking([said(1, long)]).split(' ').length, WORDS)
})

test("trial: a variant that adds a door is written under its own name, over the session's persona", async () => {
  let saw: string[] = []
  let door: Arrival = (
    { since },
  ) => (saw.push(since),
    Promise.resolve([{ door: 'notice', eids: ['x1'], text: 'x1' }]))
  let row = await run(g.storage, vocab, search, {
    eid: 'c',
    entry: 'e7',
    needed: 'm',
  }, { as: 'v', arrivals: [door] })
  let t = row?.trial as Record<string, unknown>
  assertEquals([t.variant, t.unasked], ['v', true])
  assertEquals(saw, ['2026-11-10T11:12:00.000Z'])
  let other = await run(g.storage, vocab, search, {
    eid: 'c',
    entry: 'e7',
    needed: 'x1',
  }, { as: 'v', arrivals: [door] })
  assertEquals((other?.trial as Record<string, unknown>).unasked, true)
})

test('trial: open with a person at start is what was open with them then, and what they answered the day before', async () => {
  let filed = { filed: { assignee: 'jeff' }, task: {} }
  let answered = (eid: string, when: string) => ({
    entity: { eid },
    decision: {},
    decided: { at: when, by: 'jeff', choice: 'yes' },
    doc: { title: eid },
    ...at('2026-11-01T00:00:00.000Z'),
  })
  await g.apply([
    doc('ask', early, filed),
    doc('shut', early, {
      ...filed,
      completed: { at: '2026-11-10T11:05:00.000Z' },
    }),
    doc('reopened', early, { ...filed, completed: { at: late } }),
    doc('after', late, filed),
    answered('settled', '2026-11-10T09:00:00.000Z'),
    answered('stale', '2026-11-08T09:00:00.000Z'),
  ])
  let [part] = await open('jeff')({
    storage: g.storage,
    vocab,
    m: { entry: 'e7', session: 's', seq: 7, at: '2026-11-10T11:17:00.000Z' },
    had: [],
    since: '2026-11-10T11:12:00.000Z',
  })
  assertEquals(part.eids.toSorted(), ['ask', 'reopened', 'settled'])
})

test("trial: said is the person's earlier words near what the session wrote in the window", async () => {
  let wrote = (eid: string, title: string, when: string) => ({
    entity: { eid },
    task: {},
    doc: { title },
    created: { at: when, via: 's' },
  })
  await g.apply([
    wrote('stale', 'An older task', '2026-11-10T11:11:00.000Z'),
    wrote('filed', 'Text the church line', '2026-11-10T11:14:00.000Z'),
    {
      entity: { eid: 'word' },
      comment: { target: 'm' },
      doc: { body: 'test with the other number' },
      created: { at: early, by: 'jeff' },
    },
  ])
  let keyed: string[] = []
  let [part] = await saidBefore(g, {
    person: 'jeff',
    floor: .8,
    meaning: (words, opts) => {
      if (opts?.within?.includes('.decision')) return Promise.resolve([])
      keyed.push(words)
      return Promise.resolve([{ entity: 'word', similarity: .9, excerpt: '' }])
    },
  })({
    storage: g.storage,
    vocab,
    m: { entry: 'e7', session: 's', seq: 7, at: '2026-11-10T11:17:00.000Z' },
    had: [],
    since: '2026-11-10T11:12:00.000Z',
  })
  assertEquals(keyed, ['Text the church line'])
  assertEquals([part.door, part.eids], ['hit', ['word']])
})

// The agent's own words a recall is keyed on, and what it lists: a meaning
// search that records what it was asked and answers m above x1 above x2.
let drafting = (key: 'entry' | 'call' | 'reply', floor?: number) => {
  let heard: { words: string; within?: string; limit?: number }[] = []
  let meaning = (
    words: string,
    o: { within?: string; limit?: number } = {},
  ) => {
    heard.push({ words, ...o })
    return Promise.resolve(
      [['m', .9], ['x1', .7], ['x2', .5]].slice(0, o.limit)
        .map(([entity, similarity]) => ({
          entity: entity as string,
          similarity: similarity as number,
          excerpt: '',
        })),
    )
  }
  let had = [
    entry(3, 'first reply', { output: {} }),
    entry(4, '', { call: { args: { task: 'T-1' } } }),
    entry(5, 'last reply', { output: {} }),
    entry(6, '', { call: { args: { body: 'last call' } } }),
    entry(6, 'a result', { result: {} }),
  ] as Bundle[]
  return drafted(g, meaning, { key, few: 2, floor })({
    storage: g.storage,
    vocab,
    m: { entry: 'e7', session: 's', seq: 7, at: '2026-11-10T11:17:00.000Z' },
    had,
    since: '2026-11-10T11:12:00.000Z',
  }).then((parts) => ({ parts, heard }))
}

for (
  let [key, words] of [
    ['entry', 'wrong answer'],
    ['call', '{"body":"last call"}'],
    ['reply', 'last reply'],
  ] as const
) {
  test(`trial: a recall keyed on the agent's ${key}`, async () => {
    let { parts, heard } = await drafting(key)
    assertEquals(heard.map((h) => [h.words, h.limit]), [[words, 2]])
    assertEquals(heard[0].within?.includes('2026-11-10T11:17:00.000Z'), true)
    assertEquals(parts.map((p) => [p.door, p.eids]), [['notice', ['m', 'x1']]])
  })
}

test('trial: a recall keyed on the agent lists only what reaches its floor', async () => {
  assertEquals((await drafting('entry', .8)).parts[0].eids, ['m'])
  assertEquals((await drafting('entry', .95)).parts, [])
})

// Where a door stands at e7 (11:17), its window opening at `since`.
let stand = (had: Bundle[] = [], since = '2026-11-10T11:12:00.000Z') => ({
  storage: g.storage,
  vocab,
  m: { entry: 'e7', session: 's', seq: 7, at: '2026-11-10T11:17:00.000Z' },
  had,
  since,
})
let by = (eid: string, when: string, more: Record<string, unknown>) => ({
  entity: { eid },
  doc: { title: '', body: `words ${eid}` },
  created: { at: when, by: 'jeff' },
  ...more,
})

test("trial: theirs is the person's comments and answers of the day on what the window names", async () => {
  await g.apply([
    { entity: { eid: 'named' }, task: {}, ...at(early) },
    by('onit', '2026-11-10T11:13:00.000Z', { comment: { target: 'named' } }),
    by('seen', '2026-11-10T11:13:00.000Z', { comment: { target: 'named' } }),
    by('elsewhere', '2026-11-10T11:13:00.000Z', {
      comment: { target: 'x1' },
    }),
    by('lastweek', '2026-11-03T11:13:00.000Z', {
      comment: { target: 'named' },
    }),
    by('tardy', late, { comment: { target: 'named' } }),
    by('priced', early, {
      decision: {},
      decided: { at: '2026-11-10T10:00:00.000Z', by: 'jeff', choice: 'Pro' },
    }),
  ])
  let had = [
    entry(5, 'read named and seen', { result: {} }),
    entry(6, '"priced" is still open', { call: {} }),
  ] as Bundle[]
  let [part] = await theirs('jeff')(stand(had))
  assertEquals(part.eids.toSorted(), ['onit', 'priced'])
  assertEquals(part.text.includes('→ Pro'), true)
})

test('trial: carried is what the session kept of the person before its compaction: memories of their words, tasks that quote them', async () => {
  let quote = 'knocks go to a helper with a fresh context, not to the operator'
  await g.apply([
    {
      ...said(1, quote),
      entity: { eid: 'his' },
      ...at('2026-11-10T11:05:00.000Z'),
      created: { at: '2026-11-10T11:05:00.000Z', by: 'jeff' },
    },
    {
      ...said(9, 'fable is capped at half'),
      entity: { eid: 'kept' },
      created: { at: '2026-11-09T21:29:00.000Z', by: 'jeff' },
      memory: { at: '2026-11-09T21:30:00.000Z', via: 's' },
    },
    {
      entity: { eid: 'filed' },
      task: {},
      doc: { title: 'Knocks', body: `Jeff, verbatim: "${quote}"` },
      created: { at: '2026-11-10T11:06:00.000Z', via: 's' },
    },
    {
      entity: { eid: 'unquoted' },
      task: {},
      doc: { title: 'Other', body: 'nothing he said' },
      created: { at: '2026-11-10T11:06:00.000Z', via: 's' },
    },
  ], { trusted: true })
  let summary = entry(2, 'summary', { checkpoint: {} }) as Bundle
  let [part] = await carried('jeff')(
    stand([summary], '2026-11-10T11:12:00.000Z'),
  )
  assertEquals(part.eids, ['kept', 'filed'])
  assertEquals(await carried('jeff')(stand([], '2026-11-10T11:12:00.000Z')), [])
})

test('trial: standing is the person and the notices that came more than once to the session or its parent', async () => {
  let notice = (eid: string, session: string, when: string, body: string) => ({
    entity: { eid },
    entry: { session, seq: 0 },
    content: { body },
    notice: {},
    ...at(when),
  })
  await g.apply([
    {
      entity: { eid: 'kid' },
      session: { persona: 'p' },
      spawned: { parent: 's' },
      ...at('2026-11-10T11:20:00.000Z'),
    },
    doc('jeff', early, { doc: { title: 'Jeff', body: 'The owner.' } }),
    notice('pace1', 's', '2026-11-10T09:35:00.000Z', 'Work-pace check'),
    notice('pace2', 's', '2026-11-10T10:35:00.000Z', 'Work-pace  check'),
    notice('once', 's', '2026-11-10T10:40:00.000Z', 'a task finished'),
  ])
  let parts = await standing('jeff')({
    ...stand([], '2026-11-10T11:20:00.000Z'),
    m: { entry: 'k1', session: 'kid', seq: 1, at: '2026-11-10T11:30:00.000Z' },
  })
  assertEquals(parts.map((p) => [p.door, p.eids]), [
    ['persona', ['jeff']],
    ['notice', ['pace1', 'pace2']],
  ])
})

test('trial: a window names a row by its eid, its number or its short handle', () => {
  let names = naming([entry(5, 'see T-41 and #0123456789', { result: {} })])
  let row = (eid: string, num?: number) => ({ entity: { eid, num } })
  assertEquals(
    [row('x', 41), row('01234567-89ab'), row('e5'), row('y', 4)].map(names),
    [true, true, true, false],
  )
})
