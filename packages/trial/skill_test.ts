// A round's file loaded twice into a graph, the deck a judge is shown, and
// the tally of their taps.

import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { signed } from '@yaks/graph/provenance'

// deno-lint-ignore no-explicit-any
type Any = any
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { modelDoc } from '@yaks/model/vocab'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { drop, find, gather, load } from './round.ts'
import { answers, deck, examples, type RoundFile, tally } from './skill.ts'
import { runs } from './tools.ts'
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
    ['round', 'variant', 'case', 'writing', 'pair', 'guess', 'judge'].map((
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
    writing: 6,
    pair: 2,
    guess: 4,
    judge: 2,
  })
  let b = all.find((x) => x.writing?.output.headline == 'B')!
  equal(b.writing.persona, 'persona')
  equal(b.cost, { dollars: 0.01, reported: false })
  equal(b.usage, { input_tokens: 10, output_tokens: 5 })
  let c = all.find((x) => x.doc?.title == 'His words')!
  equal(c.case.base, all.find((x) => x.doc?.title == 'The office')!.entity.eid)
  equal(all.find((x) => x.riddle)!.riddle.name, 'Zapier')

  let less = await load(g, { ...file, pairs: file.pairs!.slice(0, 1) })
  equal([less.removed, less.left], [1, 0])
  equal(kinds(await gather(g, first.round)).pair, 1)

  await drop(g, first.round)
  equal(await g.read('.writing'), [])
  equal(await g.read('.variant'), [])
  equal(await g.read('.case'), [])
  equal(await g.read('.judge'), [])
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
      writing: { round, case: one.case, output: pitch('Mine') },
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
      '',
      'By variant   attempts  shown  preferred   neither  grabbed',
      'none                2      1   1 (100%)    0 (0%)        1',
      'plain               2      2     0 (0%)   1 (50%)        0',
      'story               2      1     0 (0%)  1 (100%)        0',
      '(their own)         1      0          -         -        0',
      '',
      'By persona   attempts  shown  preferred  neither  grabbed',
      'blank               5      2    1 (50%)  1 (50%)        1',
      'persona             1      2     0 (0%)  1 (50%)        0',
      '(their own)         1      0          -        -        0',
      '',
      'By case     attempts  shown  preferred   neither  grabbed',
      'The office         3      3    1 (33%)   1 (33%)        1',
      'His words          1      1     0 (0%)  1 (100%)        0',
      'Zap                3      0          -         -        0',
      '',
      'Known answers: 1 pair (1 a person tapped, 0 planted).',
      'Passing: no share is set on this round, so no judge has passed (yak trial pass <round> <share>).',
      'sat: the known answers the judge gave a verdict on; a taught judge sits only planted pairs and held-out taps. agreed: its pick was the winner; neither, or a tie, is not agreeing.',
      'guesses: mean guesses until right in the open form, a miss counted as its cap plus one. among: how often the pick among the group was right.',
      '',
      'Judge                               sat  agreed    result',
      'The guessing game, among form (r1)    0       -  untested',
      'The guessing game, open form (r1)     0       -  untested',
      '',
      'Not to be used: The guessing game, among form (r1) is untested (it sat no known answer). Its guesses at every attempt, apart:',
      '',
      'By variant  guesses       among',
      'none              -  100% (n=1)',
      '',
      'By persona  guesses       among',
      'blank             -  100% (n=1)',
      '',
      'By case  guesses       among',
      'Zap            -  100% (n=1)',
      '',
      'Not to be used: The guessing game, open form (r1) is untested (it sat no known answer). Its guesses at every attempt, apart:',
      '',
      'By variant    guesses  among',
      'none        4.0 (n=1)      -',
      'plain       1.0 (n=1)      -',
      'story       2.0 (n=1)      -',
      '',
      'By persona    guesses  among',
      'blank       2.3 (n=3)      -',
      '',
      'By case    guesses  among',
      'Zap      2.3 (n=3)      -',
      '',
      "By variant: over 3 variants, Spearman's rho between the share a person preferred and its mean guesses until right is 0.87: the variants preferred take more guesses (they disagree).",
      '',
      'Grabbed:',
      '- "A" [none / blank / The office]',
      '',
      'Why:',
      '- says who it is for: chose "A" [none / blank / The office] over "B" [plain / persona / The office]',
    ],
  )
})

// A round to test judges on: six pitches of one riddle, a planted pair (the
// found copy against a weak rewrite), four planned pairs, and judges that
// compare pairs or guess at one pitch at a time.
let trial: RoundFile = {
  key: 'k1',
  title: 'Judged',
  skill: 'copy',
  output: ['headline'],
  variants: ['found', 'weak', 'plain', 'story'].map((key) => ({
    key,
    title: key,
    body: key,
  })),
  cases: [{ key: 'zap', title: 'Zap', body: 's', kind: 'riddle', name: 'Z' }],
  attempts: ['found', 'weak', 'plain', 'story'].flatMap((variant) =>
    [1, 2].map((run) => ({
      key: `${variant}.${run}`,
      case: 'zap',
      variant,
      persona: false,
      run,
      output: { headline: `${variant} ${run}` },
    }))
  ),
  judges: [
    { key: 'agrees', title: 'Agrees' },
    { key: 'contrary', title: 'Contrary' },
    { key: 'selector', title: 'Selector', taught: true },
    { key: 'game', title: 'Guessing game' },
  ],
  pairs: [
    ['plain.1', 'story.1'],
    ['plain.2', 'story.2'],
    ['found.2', 'plain.1'],
    ['weak.2', 'story.1'],
  ],
  known: [['found.1', 'weak.1']],
  // The game guesses the found copy at once and its weak rewrite never, and
  // takes one guess more at each story than at its plain rival.
  guesses: Object.entries({
    'found.1': 1,
    'weak.1': null,
    'plain.1': 1,
    'story.1': 2,
    'plain.2': 2,
    'story.2': 2,
  }).map(([attempt, rank]) => ({
    attempt,
    judge: 'game',
    form: 'open',
    guesses: [],
    rank,
    cap: 3,
  })),
}

// What the test person would rather read, by the two headlines of a pair, and
// with the planted pair what every judge should pick.
let taste: Record<string, string> = {
  'plain 1|story 1': 'plain 1',
  'plain 2|story 2': 'plain 2',
  'found 2|plain 1': 'found 2',
}
let truth: Record<string, string> = { ...taste, 'found 1|weak 1': 'found 1' }

test('every judge sits the known answers unmarked, and one that fails is shown apart', async () => {
  let g = await open()
  let { round } = await load(g, trial)
  await g.apply([{ entity: { eid: 'tester' }, doc: { title: 'Tester' } }])
  let all = async (): Promise<Any[]> => await gather(g, round)
  let rows = await all()
  let headline = (eid: string): string =>
    rows.find((b) => b.entity.eid == eid).writing.output.headline
  type Sides = { first: { eid: string }; second: { eid: string } }
  let sides = (c: Sides) => [c.first.eid, c.second.eid]
  let names = (c: Sides) => sides(c).map(headline).sort().join('|')
  let judge = async (key: string) =>
    (await g.address([`judge:copy:${key}`])).get(`judge:copy:${key}`)!
  let tool = async (name: string, args: Record<string, unknown>) => {
    // The runner applies what a tool answers, less its words.
    let out: Any[] = await runs()[name]!(
      { entity: { eid: 'c' }, call: { args }, $actor: { by: 'tester' } },
      g,
    )
    let rows = out.filter((b) => !b.output)
    if (rows.length) await g.apply(signed(rows, { by: 'tester' }))
    return out.find((b) => b.output).content.body
  }
  let said =
    (who: string, pick: (c: Sides) => string | undefined) =>
    async (c: Sides, i: number) => ({
      entity: { eid: `${who}${i}` },
      ...who == 'tester' ? { created: { by: who, at: String(i) } } : {},
      preference: {
        first: c.first.eid,
        second: c.second.eid,
        chose: sides(c).find((e) => headline(e) == pick(c)),
        ...who == 'tester' ? {} : { judge: await judge(who) },
      },
    })

  // One pair is held out before anyone taps, then a test person taps three.
  let blind = deck(rows).cards
  let kept = rows.find((b) =>
    b.pair && [b.pair.a, b.pair.b].map(headline).sort().join('|') ==
      'plain 2|story 2'
  )
  await g.apply([{ entity: kept.entity, held_out: {} }])
  await g.apply(
    await Promise.all(
      blind.filter((c) => taste[names(c)]).map(
        said('tester', (c) => taste[names(c)]),
      ),
    ),
  )
  // Holding more takes only pairs nobody has tapped, and the same ones again.
  equal(
    await tool('trial_hold', { round: 'k1', share: 0.4 }),
    "1 more of k1's pairs held out: 2 of 5 now are",
  )
  equal(
    await tool('trial_hold', { round: 'k1', share: 0.4 }),
    "0 more of k1's pairs held out: 2 of 5 now are",
  )
  let held = (await all()).filter((b) => b.held_out)
  equal(
    held.map((b) => taste[[b.pair.a, b.pair.b].map(headline).sort().join('|')])
      .sort(),
    ['plain 2', undefined],
  )

  // His taps are known answers the moment they exist, beside the planted one.
  equal(
    [...answers(await all()).values()].map((k) =>
      [headline(k.winner), k.tapped, k.held].join()
    ).sort(),
    [
      'found 1,false,false',
      'found 2,true,false',
      'plain 1,true,false',
      'plain 2,true,true',
    ],
  )

  // What a judge is handed says nothing of which pairs are known or held,
  // and carries no tap but its own.
  let handed = deck(await all(), await judge('agrees'))
  equal(
    handed.cards.map(names).sort(),
    [
      ...Object.keys(truth),
      'story 1|weak 2',
    ].sort(),
  )
  ok(!/known|winner|held|preference|chose/.test(JSON.stringify(handed)))

  // A selector's examples are the person's taps, less the held-out pair's.
  equal(examples(await all(), 'tester').map(names).sort(), [
    'found 2|plain 1',
    'plain 1|story 1',
  ])

  // Agrees and the selector pick every winner and Contrary every loser; on
  // the pair nobody settled they differ too.
  let other = (c: Sides) =>
    sides(c).map(headline).find((h) => h != truth[names(c)])
  for (
    let [who, pick] of [
      ['agrees', (c: Sides) => truth[names(c)] ?? 'story 1'],
      ['selector', (c: Sides) => truth[names(c)] ?? 'story 1'],
      ['contrary', (c: Sides) => truth[names(c)] ? other(c) : 'weak 2'],
    ] as const
  ) await g.apply(await Promise.all(handed.cards.map(said(who, pick))))

  // The passing share is a person's to set, and setting it again replaces it.
  await tool('trial_pass', { round: 'k1', share: 0.5 })
  equal(
    await tool('trial_pass', { round: 'k1', share: 0.8 }),
    'a judge of k1 now passes by agreeing on 80% of the known answers it sat',
  )

  let lines = tally(await all()).split('\n')
  equal(lines.slice(lines.findIndex((l) => l.startsWith('Known answers'))), [
    'Known answers: 4 pairs (3 a person tapped, 1 planted).',
    'Held out from selectors: 2 of 5 pairs, 1 of them tapped.',
    "Passing: a judge's pick is the winner on at least 80% of the known answers it sat (set by Tester).",
    'sat: the known answers the judge gave a verdict on; a taught judge sits only planted pairs and held-out taps. agreed: its pick was the winner; neither, or a tie, is not agreeing.',
    'guesses: mean guesses until right in the open form, a miss counted as its cap plus one. among: how often the pick among the group was right.',
    '',
    'Judge              sat    agreed  result',
    'Agrees               4  4 (100%)  passed',
    'Selector (taught)    2  2 (100%)  passed',
    'Contrary             4    0 (0%)  failed',
    'Guessing game        3   2 (67%)  failed',
    '',
    'Agrees passed. Its verdicts on the pairs with no known answer:',
    '',
    'By variant  judged    picked',
    'weak             1    0 (0%)',
    'story            1  1 (100%)',
    '',
    'By persona  judged   picked',
    'blank            2  1 (50%)',
    '',
    'By case  judged   picked',
    'Zap           2  1 (50%)',
    '',
    'Selector (taught) passed. Its verdicts on the pairs with no known answer:',
    '',
    'By variant  judged    picked',
    'weak             1    0 (0%)',
    'story            1  1 (100%)',
    '',
    'By persona  judged   picked',
    'blank            2  1 (50%)',
    '',
    'By case  judged   picked',
    'Zap           2  1 (50%)',
    '',
    'Not to be used: Contrary failed (it agreed on 0 of the 4 known answers it sat). Its verdicts on the pairs with no known answer, apart:',
    '',
    'By variant  judged    picked',
    'weak             1  1 (100%)',
    'story            1    0 (0%)',
    '',
    'By persona  judged   picked',
    'blank            2  1 (50%)',
    '',
    'By case  judged   picked',
    'Zap           2  1 (50%)',
    '',
    'Not to be used: Guessing game failed (it agreed on 2 of the 3 known answers it sat). Its guesses at every attempt, apart:',
    '',
    'By variant    guesses  among',
    'found       1.0 (n=1)      -',
    'weak        4.0 (n=1)      -',
    'plain       1.5 (n=2)      -',
    'story       2.0 (n=2)      -',
    '',
    'By persona    guesses  among',
    'blank       2.0 (n=6)      -',
    '',
    'By case    guesses  among',
    'Zap      2.0 (n=6)      -',
    '',
    "By variant: over 3 variants, Spearman's rho between the share a person preferred and its mean guesses until right is -1.00: the variants preferred are guessed sooner (they agree).",
  ])
})
