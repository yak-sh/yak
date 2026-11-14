// A round of matches between any sides: planned by trial_match, tapped by
// people, compared by a judge that reads documents here and drafts the host
// sees, and tallied as where each side stands.

import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { signed } from '@yaks/graph/provenance'
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { effects } from '@yaks/effects'
import { kernelDoc } from '@yaks/kernel/vocab'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import type { Model } from '@yaks/model'
import { modelDoc } from '@yaks/model/vocab'
import { personaDoc } from '@yaks/persona'
import { processDoc } from '@yaks/process'
import { ram } from '@yaks/ram'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { running } from './effects.ts'
import { matched, measured, places } from './match.ts'
import { find, gather } from './round.ts'
import { type Answering, asking } from './run.ts'
import { runs } from './tools.ts'
import { trialDoc } from './vocab.ts'

// deno-lint-ignore no-explicit-any
type Any = any

let vocab = loadVocab([
  kernelDoc,
  keyDoc,
  aliasDoc,
  docDoc,
  modelDoc,
  sessionDoc,
  processDoc,
  personaDoc,
  toolsDoc,
  trialDoc,
  {
    $defs: {
      created: {
        component: true,
        type: 'object',
        properties: { by: { type: 'string' } },
      },
    },
  },
], [keyKeywords])

// Two documents here, a draft the host sees and one it does not.
let [d1, d2] = [crypto.randomUUID(), crypto.randomUUID()]
let SEEN = new Map<string, string>([[d1, 'Draft one, the warmest of all']])
let JUDGE = 'Which?\n<a>$a</a>\n<b>$b</b>'

// A judge at a cent a call that picks the longer side.
let asked: string[] = []
let model: Model = (req) => {
  let text = (req.items[0] as { text: string }).text
  asked.push(text)
  let [a, b] = [/<a>([^]*)<\/a>/, /<b>([^]*)<\/b>/].map((r) =>
    text.match(r)![1]
  )
  return Promise.resolve({
    id: 'r',
    model: req.model,
    items: [{
      kind: 'assistant',
      text: '```json\n' +
        JSON.stringify({
          chose: a.length >= b.length ? 'A' : 'B',
          why: 'longer',
        }) +
        '\n```',
    }],
    usage: { input_tokens: 100, output_tokens: 20 },
    cost: 0.01,
  })
}
let answering: Answering = (names) =>
  Promise.resolve({
    model,
    name: names.model ?? 'fake-1',
    price: { input: 1, output: 2 },
  })
let see = (eids: string[]) =>
  Promise.resolve(
    new Map(eids.filter((e) => SEEN.has(e)).map((e) => [e, SEEN.get(e)!])),
  )

let fx = effects(vocab)
let g = graph({
  storage: ram(vocab, { number: true }),
  vocab,
  plugins: [keys(vocab), aliases(), fx],
})
await g.install()
await g.apply([
  { entity: { eid: 'warm' }, doc: { title: 'Warm', body: 'A warm cover' } },
  { entity: { eid: 'plain' }, doc: { title: 'Plain' } },
  { entity: { eid: 'ada' }, doc: { title: 'Ada' } },
  { entity: { eid: 'bo' }, doc: { title: 'Bo' } },
])
let going: Promise<unknown>[] = []
let handled = running(g, () => ({ ...asking(g, answering), see }))
fx.handle({
  round_run: (...args) => {
    let p = Promise.resolve(handled.round_run(...args))
    going.push(p)
    return p
  },
})
let tool = async (name: string, args: Record<string, unknown>) => {
  let out: Bundle[] = await runs({
    asking: () => ({ ...asking(g, answering), see }),
    page: (round) => `https://tap/${round.entity.eid}`,
  })[name]!(
    {
      entity: { eid: crypto.randomUUID() },
      call: { args },
      $actor: { by: 'ada' },
    },
    g,
  ) as Bundle[]
  let rows = out.filter((b) => !b.output)
  if (rows.length) await g.apply(signed(rows, { by: 'ada' }))
  await Promise.all(going)
  return String((out.find((b) => b.output)?.content as Any)?.body)
}
let sides = ['warm', 'plain', d1, d2]
let planned = await tool('trial_match', {
  key: 'covers',
  title: 'Covers',
  sides,
  judge: {
    title: 'Longer',
    question: JUDGE,
    provider: 'fake',
    model: 'fake-1',
  },
})
let round = await find(g, 'covers')
let all = () => gather(g, round)

// Each person taps a pair as the page does: as themselves, naming the pair.
let tap = async (by: string, a: string, b: string, chose: string | null) => {
  let pair = (await all()).find((p) =>
    p.pair && [a, b].includes((p.pair as Any).a) &&
    [a, b].includes((p.pair as Any).b)
  )!
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    preference: { first: a, second: b, chose, pair: pair.entity.eid },
    created: { by },
  }])
}

test('every two sides are a pair under each question, and planning again lands on the same rows', async () => {
  equal(
    matched({ key: 'k', title: 'K', sides: ['a', 'b', 'c'] }).filter((b) =>
      b.pair
    ).length,
    3,
  )
  equal(
    matched({
      key: 'k',
      title: 'K',
      sides: ['a', 'b', 'c'],
      questions: ['Words?', 'Looks?'],
    })
      .filter((b) => b.pair).length,
    6,
  )
  ok(planned.includes('4 sides in 6 pairs'), planned)
  ok(planned.includes('https://tap/' + round), planned)
  await tool('trial_match', {
    key: 'covers',
    title: 'Covers',
    sides,
    judge: { question: JUDGE, provider: 'fake', model: 'fake-1' },
  })
  equal((await all()).filter((b) => b.pair).length, 6)
})

test('a judge compares documents and the drafts the host sees, in both orders, and counts once it passes', async () => {
  await tap('ada', 'warm', 'plain', 'warm')
  await tap('bo', 'warm', 'plain', 'warm')
  await tap('bo', d1, 'warm', d1)
  let quote = await tool('trial_cap', { round: 'covers', cap: 0 })
  ok(quote.startsWith('0 writers and 6 judges to ask, about'), quote)
  await tool('trial_cap', { round: 'covers', cap: 1 })
  // d2 is seen by nobody: of its three pairs nothing is asked.
  equal(asked.length, 6)
  ok(asked.some((t) => t.includes('Draft one') && t.includes('Warm')))
  // Before a passing share, the judge does not count: only taps rate.
  let before = places(await all())
  equal(before.find((p) => p.eid == 'plain')!.rated[0].judges, 0)
  await tool('trial_pass', { round: 'covers', share: 1 })
  let after = places(await all())
  equal(after.map((p) => p.eid).slice(0, 2), [d1, 'warm'])
  let warm = after.find((p) => p.eid == 'warm')!
  equal([warm.rated[0].people, warm.rated[0].judges], [2, 1])
  ok(
    measured(warm, 4).startsWith('Second of 4 by its rating'),
    measured(warm, 4),
  )
})

test('the tally of a match round lists every side highest first, the first few marked to offer', async () => {
  let said = await tool('trial_tally', { round: 'covers', few: 2 })
  let lines = said.split('\n')
  ok(lines[0].includes('4 sides, highest first; the first 2'), lines[0])
  equal(lines.slice(1).map((l) => l.slice(0, 2)), ['* ', '* ', '- ', '- '])
  ok(lines[1].startsWith(`* ${d1}: First of 4`), lines[1])
})
