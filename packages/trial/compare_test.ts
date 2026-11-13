// A judge that compares two attempts: each pair is asked in both orders, a
// verdict is a preference row naming the judge, and a judge that leans to
// the first it is shown agrees with no known answer.

import { equal, ok, test } from '@yaks/testing'
import { type Graph, graph } from '@yaks/graph'
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { kernelDoc } from '@yaks/kernel/vocab'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { modelDoc } from '@yaks/model/vocab'
import { personaDoc } from '@yaks/persona'
import { processDoc } from '@yaks/process'
import { ram } from '@yaks/ram'
import { sessionDoc, sessions } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { compare, find, gather, keyed, load } from './round.ts'
import { run } from './run.ts'
import { type RoundFile, tally } from './skill.ts'
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
  toolsDoc,
  processDoc,
  personaDoc,
  trialDoc,
], [keyKeywords])

let ask = 'Which is better?\nA: $a\nB: $b'
let attempt = (key: string, headline: string) => ({
  key,
  case: key.split('.')[0],
  variant: key.split('.')[1],
  persona: false,
  output: { headline },
})
let file: RoundFile = {
  key: 'known',
  title: 'Published against rewritten',
  skill: 'copy',
  output: ['headline'],
  using: { provider: 'fake', model: 'fake-1' },
  judges: [
    { key: 'fair', title: 'Fair', form: 'pair', question: ask },
    {
      key: 'leans',
      title: 'Leans to A',
      form: 'pair',
      question: 'Which reads better?\nA: $a\nB: $b',
    },
  ],
  variants: [
    { key: 'found', title: 'Published', body: '' },
    { key: 'plain', title: 'Plain', body: 'write plain' },
  ],
  cases: [
    { key: 'one', title: 'One', body: 'sheet' },
    { key: 'two', title: 'Two', body: 'sheet' },
  ],
  attempts: [
    attempt('one.found', 'Think small'),
    attempt('one.plain', 'A small car'),
    attempt('two.found', 'Ship it'),
    attempt('two.plain', 'We ship things'),
  ],
  known: [['one.found', 'one.plain'], ['two.found', 'two.plain']],
  compared: [{ judge: 'fair' }, {
    judge: 'leans',
    pairs: [['one.found', 'one.plain']],
  }],
}

let g: Graph = graph({
  storage: ram(vocab, { number: true }),
  vocab,
  plugins: [keys(vocab), aliases(), sessions()],
})
await g.install()
let { round } = await load(g, file)
await g.apply([{ entity: { eid: round }, passing: { share: 0.75 } }])

// The fair judge picks the published pitch wherever it is shown; the other
// always picks A.
let asked: string[] = []
let seen = new Set<string>()
let answer = async () => {
  for (let e of await g.read('.entry .using *') as Any[]) {
    if (seen.has(e.entity.eid)) continue
    seen.add(e.entity.eid)
    let body: string = e.content.body
    asked.push(body)
    let chose = body.startsWith('Which reads better?') ||
        ['Think small', 'Ship it'].includes(body.match(/A: (.*)/)![1])
      ? 'A'
      : 'B'
    await g.apply([{
      entity: { eid: `answer-${seen.size}` },
      entry: { session: e.entry.session },
      content: {
        body: '```json\n' + JSON.stringify({ chose, why: 'because' }) +
          '\n```',
      },
      output: { source: e.entry.session },
      usage: { input_tokens: 10, output_tokens: 5 },
      cost: { dollars: 0.01, reported: true },
    }])
  }
}
let lines: string[] = []
let label = await keyed(g, await gather(g, round, true))
let ran = await run(g, round, {
  cap: 1,
  pause: answer,
  label,
  out: (l) => lines.push(l),
})

test('each pair is asked of each judge in both orders, and what comes back is a row naming its judge', async () => {
  // Fair: two pairs twice; leans: one pair twice.
  equal([ran.asked, ran.returned, ran.spent], [6, 6, 0.06])
  ok(lines[0].startsWith('0 writers and 6 judges to ask'), lines[0])
  let rows = (await gather(g, round)).filter((b) => b.preference)
    .map((b) => b.preference as Any)
  equal(rows.length, 6)
  ok(rows.every((r) => r.judge && r.why == 'because' && r.session))
  equal(
    asked.filter((t) => t.includes('A: Think small')).length,
    asked.filter((t) => t.includes('B: Think small')).length,
  )
})

test('a judge that picked the published pitch in both orders agrees, one that leaned to a side does not', async () => {
  let said = tally(await gather(g, round), label)
  ok(/Fair +2 +2 \(100%\) +passed/.test(said), said)
  ok(/Leans to A +1 +0 \(0%\) +failed/.test(said), said)
})

test('a second run asks nothing', async () => {
  equal((await run(g, round, { cap: 1, pause: answer })).asked, 0)
})

test('a judge is planned over every pair of a round it has not compared, once', async () => {
  let before = (await gather(g, round, true)).filter((b) => b.preference).length
  equal(before, 6)
  // `leans` compared one pair; the command plans the other, in both orders.
  let did = await compare(g, round, 'leans')
  equal(did.planned, 2)
  equal((await compare(g, round, 'leans')).planned, 0)
  equal((await run(g, round, { cap: 1, pause: answer })).asked, 2)
  equal(await find(g, 'known'), round)
})

test('a call that names no model stops the run instead of waiting on a session that never starts', async () => {
  let bare = (await load(g, { ...file, key: 'bare', using: undefined })).round
  let lines: string[] = []
  let ran = await run(g, bare, {
    cap: 1,
    pause: answer,
    out: (l) => lines.push(l),
  })
  equal([ran.asked, ran.left], [0, 12])
  ok(ran.stopped?.includes('names no model'), ran.stopped)
})
