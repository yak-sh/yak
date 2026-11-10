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
import { before, cases, run } from './moment.ts'

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
    created: props({ at: 'string' }),
    completed: props({ at: 'string' }),
    notified: props({ at: 'string', via: 'string' }),
    task: { ...obj, status: { completed: 'done', default: 'open' } },
    session: props({ persona: 'string' }),
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
  entry(3, 'how do I pay', {}),
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

test('trial: the search is asked the words of the latest input or notice', async () => {
  asked.length = 0
  await score('m')
  assertEquals(asked, ['pace notice'])
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
