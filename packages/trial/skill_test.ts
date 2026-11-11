// A round's file loaded twice into a graph, the deck a judge is shown, and
// the tally of their taps.

import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'

// deno-lint-ignore no-explicit-any
type Any = any
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { modelDoc } from '@yaks/model/vocab'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { drop, find, gather, load } from './round.ts'
import { deck, type RoundFile, tally } from './skill.ts'
import { trialDoc } from './vocab.ts'

let vocab = loadVocab([keyDoc, aliasDoc, docDoc, modelDoc, trialDoc, {
  $defs: {
    created: {
      component: true,
      type: 'object',
      properties: { by: { type: 'string' }, at: { type: 'string' } },
    },
    persona: { component: true, type: 'object' },
  },
}], [keyKeywords])

let open = async () => {
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [keys(vocab), aliases()],
  })
  await g.install()
  await g.apply([{ entity: { eid: 'persona' }, persona: {} }])
  return g
}

let pitch = (headline: string) => ({ headline, brief: 'One. Two.' })
let attempt = (
  kase: string,
  variant: string,
  persona: boolean,
  headline: string,
) => ({
  key: `${kase}.${variant}.${persona ? 'persona' : 'blank'}.1`,
  case: kase,
  variant,
  persona,
  run: 1,
  model: 'fable',
  output: pitch(headline),
  usage: { input: 10, output: 5, dollars: 0.01, ms: 9 },
})
let file: RoundFile = {
  key: 'r1',
  title: 'Round one',
  skill: 'copy',
  output: ['headline', 'brief'],
  persona: 'persona',
  variants: ['none', 'plain', 'story'].map((key) => ({
    key,
    title: key,
    body: key == 'none' ? '' : `write ${key}`,
    source: null,
  })),
  cases: [
    { key: 'office', title: 'The office', body: 'facts' },
    { key: 'words', title: 'His words', body: 'said', base: 'office' },
    {
      key: 'zap',
      title: 'Zap',
      body: 'sheet',
      kind: 'riddle',
      name: 'Zapier',
      forbidden: ['zap'],
      group: 'automation',
    },
  ],
  attempts: [
    attempt('office', 'none', false, 'A'),
    attempt('office', 'plain', true, 'B'),
    attempt('words', 'story', false, 'C'),
    attempt('zap', 'none', false, 'Z1'),
    attempt('zap', 'plain', false, 'Z2'),
    attempt('zap', 'story', false, 'Z3'),
  ],
  pairs: [
    ['office.none.blank.1', 'office.plain.persona.1'],
    ['office.plain.persona.1', 'words.story.blank.1'],
  ],
  guesses: [
    { attempt: 'zap.none.blank.1', form: 'open', guesses: ['x'], cap: 3 },
    {
      attempt: 'zap.plain.blank.1',
      form: 'open',
      guesses: ['Zapier'],
      rank: 1,
    },
    {
      attempt: 'zap.story.blank.1',
      form: 'open',
      guesses: ['a', 'b'],
      rank: 2,
    },
    { attempt: 'zap.none.blank.1', form: 'among', guesses: ['zap'], rank: 1 },
  ],
}

let kinds = (all: Bundle[]) =>
  Object.fromEntries(
    ['round', 'variant', 'case', 'attempt', 'pair', 'guess'].map((
      k,
    ) => [k, all.filter((b) => b[k]).length]),
  )

test('a round loaded twice holds its rows once, and a dropped pair goes', async () => {
  let g = await open()
  let first = await load(g, file)
  let again = await load(g, file)
  equal(again.round, first.round)
  equal(await find(g, 'r1'), first.round)
  let all: Any[] = await gather(g, first.round)
  equal(kinds(all), {
    round: 1,
    variant: 3,
    case: 3,
    attempt: 6,
    pair: 2,
    guess: 4,
  })
  let b = all.find((x) => x.attempt?.output.headline == 'B')!
  equal(b.attempt.persona, 'persona')
  equal(b.cost, { dollars: 0.01, reported: false })
  equal(b.usage, { input_tokens: 10, output_tokens: 5 })
  let c = all.find((x) => x.doc?.title == 'His words')!
  equal(c.case.base, all.find((x) => x.doc?.title == 'The office')!.entity.eid)
  equal(all.find((x) => x.riddle)!.riddle.name, 'Zapier')

  let less = await load(g, { ...file, pairs: file.pairs!.slice(0, 1) })
  equal([less.removed, less.left], [1, 0])
  equal(kinds(await gather(g, first.round)).pair, 1)

  await drop(g, first.round)
  equal(await g.read('.attempt'), [])
  equal(await g.read('.variant'), [])
  equal(await g.read('.case'), [])
})

test("the deck hides who wrote a pitch, keeps a judge's taps and sets their own pitch against the round's", async () => {
  let g = await open()
  let { round } = await load(g, file)
  let blind = deck(await gather(g, round))
  equal(blind.parts, ['headline', 'brief'])
  equal(blind.cards.map((c) => c.title), ['The office', 'The office'])
  equal(
    blind.cards.map((c) =>
      [c.first, c.second].map((p) => p.parts.headline).sort().join('')
    ),
    ['AB', 'BC'],
  )
  ok(!/variant|persona|model|plain|story/.test(JSON.stringify(blind.cards)))

  let [one, two] = blind.cards
  await g.apply([
    {
      entity: { eid: 'p1' },
      created: { by: 'jeff', at: '1' },
      preference: {
        first: one.first.eid,
        second: one.second.eid,
        chose: one.second.eid,
        why: 'says who it is for',
      },
    },
    {
      entity: { eid: 'p2' },
      created: { by: 'jeff', at: '2' },
      preference: { first: two.first.eid, second: two.second.eid },
    },
    {
      entity: { eid: 'g1' },
      created: { by: 'jeff', at: '3' },
      grabbed: { attempt: one.second.eid },
    },
    {
      entity: { eid: 'own' },
      created: { by: 'jeff', at: '4' },
      attempt: { round, case: one.case, output: pitch('Mine') },
    },
    {
      entity: { eid: 'p3' },
      created: { by: 'other', at: '5' },
      preference: { first: one.first.eid, second: one.second.eid },
    },
  ])
  let all = await gather(g, round)
  let seen = deck(all, 'jeff')
  equal(seen.cards.length, 5)
  equal(
    [seen.cards[0].chose, seen.cards[0].why, seen.cards[0].preference],
    [one.second.eid, 'says who it is for', 'p1'],
  )
  equal(seen.cards[0].second.grabbed, 'g1')
  equal(seen.cards[1].chose, null)
  equal(
    seen.cards.slice(2).map((c) =>
      [c.first, c.second].map((p) => p.parts.headline).sort().join('')
    ).sort(),
    ['AMine', 'BMine', 'CMine'],
  )
  equal(seen.cards[2].chose, undefined)

  equal(
    tally(all.filter((b) => b.entity.eid != 'p3')).split('\n'),
    [
      'Round one (skill: copy)',
      '7 attempts, 2 pairs, 2 comparisons made, 1 of them neither, 1 grabbed, 4 guesses.',
      'guesses: mean guesses until right in the open form, a miss counted as its cap plus one. among: how often the pick among the group was right.',
      '',
      'By variant   attempts  shown  preferred   neither  grabbed    guesses       among',
      'none                2      1   1 (100%)    0 (0%)        1  4.0 (n=1)  100% (n=1)',
      'plain               2      2     0 (0%)   1 (50%)        0  1.0 (n=1)           -',
      'story               2      1     0 (0%)  1 (100%)        0  2.0 (n=1)           -',
      '(their own)         1      0          -         -        0          -           -',
      '',
      'By persona   attempts  shown  preferred  neither  grabbed    guesses       among',
      'blank               5      2    1 (50%)  1 (50%)        1  2.3 (n=3)  100% (n=1)',
      'persona             1      2     0 (0%)  1 (50%)        0          -           -',
      '(their own)         1      0          -        -        0          -           -',
      '',
      'By case     attempts  shown  preferred   neither  grabbed    guesses       among',
      'The office         3      3    1 (33%)   1 (33%)        1          -           -',
      'His words          1      1     0 (0%)  1 (100%)        0          -           -',
      'Zap                3      0          -         -        0  2.3 (n=3)  100% (n=1)',
      '',
      "Agreement: over 3 variants, Spearman's rho between the share preferred and the mean guesses until right is 0.87: the variants preferred take more guesses (they disagree).",
      '',
      'Grabbed:',
      '- "A" [none / blank / The office]',
      '',
      'Why:',
      '- says who it is for: chose "A" [none / blank / The office] over "B" [plain / persona / The office]',
    ],
  )
})
