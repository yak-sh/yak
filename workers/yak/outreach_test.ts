// An outreach trial: sent as one batch whose requests share a cached prefix,
// read again at each wake until it has ended, then kept as one letter a space.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, type Comp, graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { platformDoc } from '@yaks/platform/vocab'
import { wakeDoc } from '@yaks/wake'
import { docs } from '@yaks/platform/outreach-vocab'
import { BASE } from '@yaks/platform/operator-model'
import { letterOf } from '@yaks/platform/outreach'
import type { Entry, Result } from '@yaks/anthropic/batches'
import { AGAIN, type Api, collect, factsOf, write } from './outreach.ts'
import type { Census } from './admin.ts'

let vocab = loadVocab(
  [kernelDoc, docDoc, platformDoc, wakeDoc, ...docs],
  [kernelKeywords],
)
let [ada, bo] = [mint(), mint()]
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
let facts = () => Promise.resolve([space(ada, 'ada'), space(bo, 'bo', [])])
// A component of a row read back.
let c = (b: Bundle, name: string) => (b[name] ?? {}) as Comp
let NOW = Date.parse('2026-11-20T00:00:00.000Z')

// A batch that ends once it has been read `after` times.
let provider = (after = 1) => {
  let sent: Entry[][] = []
  let reads = 0
  let said = (custom_id: string, text: string): Result => ({
    custom_id,
    result: {
      type: 'succeeded',
      message: {
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1000, output_tokens: 1000 },
      },
    },
  })
  let api: Api = {
    submit: (requests) => {
      sent.push(requests)
      return Promise.resolve({ id: 'b1', processing_status: 'in_progress' })
    },
    read: (id) =>
      Promise.resolve({
        id,
        processing_status: ++reads > after ? 'ended' : 'in_progress',
      }),
    results: () =>
      Promise.resolve([
        said(ada, 'Subject: Roster can be searched\n\nI drafted it.'),
        { custom_id: bo, result: { type: 'errored', error: { type: 'x' } } },
      ]),
  }
  return { api, sent }
}

let trialIn = async () => {
  let g = graph({ vocab, storage: ram(vocab) })
  let trial = mint()
  await g.apply([
    {
      entity: { eid: BASE },
      doc: { title: 'Operator', body: 'I am the Operator.' },
    },
    {
      entity: { eid: trial },
      outreach_trial: {
        changelog: 'I can text you now.',
        model: 'claude-opus-5-5',
      },
    },
  ])
  return { g, trial }
}

test('a trial sends one request a space, each after the same cached prefix', async () => {
  let { g, trial } = await trialIn()
  let { api, sent } = provider()
  await write(g, facts, api, trial, NOW)
  await write(g, facts, api, trial, NOW)
  equal(sent.length, 1)
  let [requests] = sent
  equal(requests.map((r) => r.custom_id), [ada, bo])
  let systems = requests.map((r) => JSON.stringify(r.params.system))
  equal(new Set(systems).size, 1)
  ok(systems[0].includes('I am the Operator.'))
  ok(systems[0].includes('I can text you now.'))
  ok(systems[0].includes('"cache_control"'))
  ok(JSON.stringify(requests[0].params.messages).includes('roster'))
  let [row] = await g.get([trial])
  equal(c(row, 'outreach_batch').id, 'b1')
  equal(c(row, 'wake').at, new Date(NOW + AGAIN).toISOString())
})

test('a trial wakes again until its batch ends, then keeps a letter a space', async () => {
  let { g, trial } = await trialIn()
  let { api } = provider(1)
  await write(g, facts, api, trial, NOW)
  await collect(g, facts, api, trial, NOW + AGAIN)
  let [waiting] = await g.get([trial])
  equal(waiting.outreach_written, undefined)
  equal(c(waiting, 'wake').at, new Date(NOW + 2 * AGAIN).toISOString())
  await collect(g, facts, api, trial, NOW + 2 * AGAIN)
  let [done] = await g.get([trial])
  equal(c(done, 'outreach_written').letters, 2)
  let [letter, failed] = await g.get([
    letterOf(trial, ada),
    letterOf(trial, bo),
  ])
  equal(letter.doc as Comp, {
    title: 'Roster can be searched',
    body: 'I drafted it.',
  })
  equal(c(letter, 'outreach_letter').stage, 'in use')
  // Opus 5.5 at batch prices: 1,000 tokens in at $4 and out at $20 a million.
  equal(c(letter, 'outreach_letter').dollars, 0.012)
  equal(c(failed, 'doc').title, '(not written: errored)')
  equal(c(failed, 'outreach_letter').stage, 'nothing built')
})

test("the platform's own accounts and test accounts get no letter; people do", () => {
  let person = (eid: string, address: string) => ({
    entity: { eid },
    person: {},
    email: { address },
  })
  let home = (eid: string, slug: string) => ({
    entity: { eid },
    space: { slug },
  })
  let seat = (space: string, person: string) => ({
    entity: { eid: `${space}-${person}` },
    member: { space, person, role: 'owner' },
  })
  let census = {
    people: [
      person('ann', 'ann@x.com'),
      person('admin', 'admin@bot.yak.sh'),
      person('probe', 'probe@bot.yak.sh'),
    ],
    spaces: [home('a', 'ann'), home('b', 'admin'), home('c', 'probe')],
    apps: [],
    seats: [seat('a', 'ann'), seat('b', 'admin'), seat('c', 'probe')],
    deploys: [],
    referrals: [],
    agents: [],
  } as unknown as Census
  equal(factsOf(census, new Date(NOW)).map((f) => f.slug), ['ann'])
})
