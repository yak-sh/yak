// An outreach trial: sent as one batch on the Operator's own model, its
// requests sharing a prefix, read again at each wake until it has ended, then
// kept as one letter a space beside what its Operator was told.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { MODEL, PROVIDER } from '@yaks/model'
import type { Answered, Asked, Batches } from '@yaks/model/batch'
import { BASE } from './operator-model.ts'
import { letterOf } from './outreach.ts'
import { AGAIN, collect, type Trials, write } from './outreach-trial.ts'

let [ada, bo] = ['ada-space', 'bo-space']
let app = {
  slug: 'roster',
  title: 'Roster',
  visits: 40,
  requests: 3,
  deployed: '2026-11-01T00:00:00.000Z',
  changed: null,
  errored: null,
  used: null,
}
let space = (eid: string, slug: string, apps = [app]) => ({
  space: eid,
  slug,
  operator: 'Lena',
  plan: 'free',
  made: null,
  people: [{ name: 'Ada', role: 'owner', signedIn: null }],
  apps,
})
let NOW = Date.parse('2026-11-20T00:00:00.000Z')
let c = (b: Bundle, name: string) => (b[name] ?? {}) as Comp

// Rows by eid, each write a patch onto them, as a graph applies one.
let store = (rows: Bundle[]) => {
  let held = new Map(rows.map((b) => [b.entity.eid, b]))
  return {
    get: (eids: string[]) =>
      Promise.resolve(eids.map((e) => held.get(e)!).filter(Boolean)),
    apply: (patches: Bundle[]) => {
      for (let p of patches) {
        let was = held.get(p.entity.eid) ?? { entity: p.entity }
        let next: Bundle = { ...was }
        for (let [k, v] of Object.entries(p)) {
          if (k != 'entity') next[k] = { ...was[k] as Comp, ...v as Comp }
        }
        held.set(p.entity.eid, next)
      }
      return Promise.resolve([])
    },
  } as unknown as Trials['graph']
}

// The base persona names the Operator's model, as the directory's does.
let sol = identityEid(MODEL, ['sol'])
let openai = identityEid(PROVIDER, ['openai'])
let directory = (trial: string, asks: Comp = {}) =>
  store([
    {
      entity: { eid: BASE },
      doc: { title: 'Operator', body: 'I am the Operator.' },
      using: { provider: openai, model: sol },
    },
    { entity: { eid: openai }, [PROVIDER]: { name: 'openai' } },
    {
      entity: { eid: sol },
      [MODEL]: { name: 'sol' },
      price: { input: 2, cached: 0.1, output: 10 },
    },
    {
      entity: { eid: trial },
      outreach_trial: { changelog: 'I can text you now.', ...asks },
    },
  ])

// A provider's batches that end once read `after` times.
let provider = (after = 1) => {
  let sent: Asked[][] = []
  let reads = 0
  let answers: Answered[] = [
    {
      id: ada,
      text: 'Subject: Roster can be searched\n\nI drafted it.',
      usage: { input_tokens: 1000, cached_tokens: 0, output_tokens: 1000 },
    },
    { id: bo, error: 'expired' },
  ]
  let api: Batches = {
    submit: (asked) => {
      sent.push(asked)
      return Promise.resolve('b1')
    },
    ended: () => Promise.resolve(++reads > after),
    results: () => Promise.resolve(answers),
  }
  return { api, sent }
}

let trials = (graph: Trials['graph'], batches: Record<string, Batches>) => ({
  graph,
  facts: () => Promise.resolve([space(ada, 'ada'), space(bo, 'bo', [])]),
  batches,
  fallback: { provider: 'anthropic', model: 'claude-opus-5-5' },
})

test("a trial sends one request a space on the Operator's own model, each after the same prefix", async () => {
  let g = directory('t1')
  let { api, sent } = provider()
  let t = trials(g, { openai: api })
  await write(t, 't1', NOW)
  await write(t, 't1', NOW)
  equal(sent.length, 1)
  let [asked] = sent
  equal(asked.map((a) => [a.id, a.model, a.cache]), [
    [ada, 'sol', 't1'],
    [bo, 'sol', 't1'],
  ])
  equal(new Set(asked.map((a) => a.system)).size, 1)
  ok(asked[0].system.includes('I am the Operator.'))
  ok(asked[0].system.includes('I can text you now.'))
  ok(asked[0].text.includes('roster'))
  let [row] = await g.get(['t1'])
  equal(c(row, 'outreach_trial').model, 'sol')
  equal(c(row, 'outreach_batch').id, 'b1')
  equal(c(row, 'outreach_batch').shared, asked[0].system)
  equal(c(row, 'wake').at, new Date(NOW + AGAIN).toISOString())
  let [letter] = await g.get([letterOf('t1', ada)])
  equal(c(letter, 'outreach_letter').brief, asked[0].text)
  equal(c(letter, 'outreach_letter').stage, 'in use')
})

test('a trial naming its model is written by that one', async () => {
  let g = directory('t1', { provider: 'anthropic', model: 'claude-x' })
  let { api, sent } = provider()
  await write(trials(g, { anthropic: api }), 't1', NOW)
  equal(sent[0][0].model, 'claude-x')
})

test('a trial wakes again until its batch ends, then fills a letter a space', async () => {
  let g = directory('t1')
  let { api } = provider(1)
  let t = trials(g, { openai: api })
  await write(t, 't1', NOW)
  await collect(t, 't1', NOW + AGAIN)
  let [waiting] = await g.get(['t1'])
  equal(waiting.outreach_written, undefined)
  equal(c(waiting, 'wake').at, new Date(NOW + 2 * AGAIN).toISOString())
  await collect(t, 't1', NOW + 2 * AGAIN)
  let [done] = await g.get(['t1'])
  equal(c(done, 'outreach_written').letters, 2)
  let [letter, failed] = await g.get([letterOf('t1', ada), letterOf('t1', bo)])
  equal(letter.doc as Comp, {
    title: 'Roster can be searched',
    body: 'I drafted it.',
  })
  // The model row's price, halved: 1,000 tokens in at $2 and out at $10 a
  // million.
  equal(c(letter, 'outreach_letter').dollars, 0.006)
  ok(String(c(letter, 'outreach_letter').brief).includes('roster'))
  equal(c(failed, 'doc'), { title: '(not written)', body: 'expired' })
  equal(c(failed, 'outreach_letter').stage, 'nothing built')
})
