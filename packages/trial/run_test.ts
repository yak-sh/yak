// A round planned as rows, written and judged by a model that answers in
// memory: what each writer and judge is asked, what comes back as rows, and
// what a second run, a cap and a stopped run each cost.

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
import { find, gather, keyed, load } from './round.ts'
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

let file: RoundFile = {
  key: 'r2',
  title: 'Round two',
  skill: 'copy',
  output: ['headline', 'brief'],
  persona: 'persona',
  using: { provider: 'fake', model: 'fake-1' },
  writers: {
    task: 'Pitch it.$rule\n$case',
    skilled: 'Follow:\n$skill\nPitch it.$rule\n$case',
    rule: ' Do not name it.',
  },
  judges: [
    {
      key: 'headline',
      title: 'The headline alone',
      form: 'open',
      shown: ['headline'],
      question: 'Which company?\n$output',
      cap: 3,
    },
    {
      key: 'among',
      title: 'Among its group',
      form: 'among',
      question: 'Which of $n?\n$output\n\n$sheets',
    },
  ],
  variants: [
    { key: 'none', title: 'No skill', body: '' },
    { key: 'plain', title: 'Plain', body: 'write plain' },
  ],
  cases: [
    {
      key: 'zap',
      title: 'Zap',
      body: 'zap sheet',
      kind: 'riddle',
      name: 'Zapier',
      group: 'automation',
    },
    {
      key: 'make',
      title: 'Make',
      body: 'make sheet',
      kind: 'riddle',
      name: 'Make',
      group: 'automation',
    },
  ],
  plan: {
    variants: ['none', 'plain'],
    cases: ['zap'],
    personas: [false, true],
    judges: ['headline', 'among'],
  },
}

let block = (o: unknown) => 'Thinking.\n```json\n' + JSON.stringify(o) + '\n```'

// The model: a writer returns a pitch that says its arm and its skill, a
// judge of the headline guesses right second, and one choosing among sheets
// picks the one that reads `zap sheet`.
let reply = (text: string, persona: unknown): string => {
  if (text.startsWith('Which company?')) {
    return block({ guesses: ['Acme', 'Zapier Inc', 'Make', 'Late'] })
  }
  if (text.startsWith('Which of')) {
    let letter = text.match(/([A-Z])\n-----\nzap sheet/)![1]
    return block({ ranking: [letter] })
  }
  return block({
    headline: `${persona ? 'persona' : 'blank'}, ${
      text.includes('write plain') ? 'plain' : 'no skill'
    }`,
    brief: 'One. Two.',
  })
}

// A graph with the round loaded and a model beside it: `answer` answers each
// request not yet answered, as whatever serves sessions would, at a cent a
// call. `asked` is every request it answered.
let open = async () => {
  let g: Graph = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [keys(vocab), aliases(), sessions()],
  })
  await g.install()
  await g.apply([{ entity: { eid: 'persona' }, persona: {} }])
  let round = (await load(g, file)).round
  let asked: Any[] = []
  let seen = new Set<string>()
  let n = 0
  let answer = async () => {
    for (let e of await g.read('.entry .using *') as Any[]) {
      if (seen.has(e.entity.eid)) continue
      seen.add(e.entity.eid)
      asked.push(e)
      let [s] = await g.get([e.entry.session]) as Any[]
      await g.apply([{
        entity: { eid: `answer-${n++}` },
        entry: { session: e.entry.session },
        content: { body: reply(e.content.body, s.session.persona) },
        output: { source: e.entry.session },
        usage: { input_tokens: 10, output_tokens: 5 },
        cost: { dollars: 0.01, reported: true },
      }])
    }
  }
  let label = await keyed(g, await gather(g, round, true))
  return { g, round, asked, answer, label }
}

let comps = async (g: Graph, round: string, name: string): Promise<Any[]> =>
  (await gather(g, round)).filter((b) => b[name]).map((b) => b[name])

let whole = await open()
let lines: string[] = []
let ran = await run(whole.g, whole.round, {
  cap: 1,
  pause: whole.answer,
  label: whole.label,
  out: (line) => lines.push(line),
})

test('a planned round is written and judged, each row from its own session', async () => {
  equal(ran, { asked: 12, returned: 12, failed: 0, left: 0, spent: 0.12 })
  let written = await comps(whole.g, whole.round, 'writing')
  equal(written.map((w) => w.output.headline).sort(), [
    'blank, no skill',
    'blank, plain',
    'persona, no skill',
    'persona, plain',
  ])
  let guessed = await comps(whole.g, whole.round, 'guess')
  // The headline judge was right second; the one among the group, first.
  equal(guessed.map((s) => [s.form, s.rank, s.cap]).sort(), [
    ...Array(4).fill(['among', 1, 2]),
    ...Array(4).fill(['open', 2, 3]),
  ])
  ok(guessed.every((s) => s.judge && s.session))
  equal(guessed.find((s) => s.form == 'among').among.toSorted(), [
    'Make',
    'Zapier',
  ])
  let said = tally(await gather(whole.g, whole.round), whole.label)
  ok(said.includes('4 attempts'), said)
  ok(said.includes('8 guesses'), said)
})

test("a writer is asked the round's wording, with no tools, and the persona arm selects the persona", async () => {
  let writers = whole.asked.filter((e) => e.content.body.includes('Pitch it.'))
  equal(writers.map((e) => e.content.body).sort(), [
    ...Array(2).fill(
      'Follow:\nwrite plain\nPitch it. Do not name it.\nzap sheet',
    ),
    ...Array(2).fill('Pitch it. Do not name it.\nzap sheet'),
  ])
  ok(whole.asked.every((e) => equal(e.sending.tools, []) ?? true))
  let sessions = await whole.g.get(
    writers.map((e) => e.entry.session),
  ) as Any[]
  equal(
    sessions.map((s) => s.session.persona ?? null).sort(),
    [null, null, 'persona', 'persona'].sort(),
  )
  // A judge sees what it is shown, and never a persona.
  let judge = whole.asked.find((e) => e.content.body.startsWith('Which co'))
  equal(judge.content.body.split('\n').length, 2)
  let [asked] = await whole.g.get([judge.entry.session]) as Any[]
  equal(asked.session.persona, undefined)
})

let quiet: string[] = []
let again = await run(whole.g, whole.round, {
  cap: 1,
  pause: whole.answer,
  out: (line) => quiet.push(line),
})

test('it says what the run will cost before it asks, and a second run asks nothing', () => {
  // The judges of what is yet to be written are counted too.
  ok(lines[0].startsWith('4 writers and 8 judges to ask'), lines[0])
  ok(lines[0].endsWith('Cap $1.00.'), lines[0])
  equal(again, { asked: 0, returned: 0, failed: 0, left: 0, spent: 0 })
  equal(whole.asked.length, 12)
  ok(quiet[0].startsWith('0 writers and 0 judges'), quiet[0])
})

// A run held to two and a half cents, then the run after it.
let capped = await open()
let short = await run(capped.g, capped.round, {
  cap: 0.025,
  jobs: 1,
  pause: capped.answer,
})
let counted: string[] = []
let rest = await run(capped.g, capped.round, {
  cap: 1,
  jobs: 2,
  pause: capped.answer,
  out: (line) => counted.push(line),
})

test('the cap stops the asking, and the next run asks only what is left', () => {
  // One writer is left, and the judges of the three that were written.
  equal([short.asked, short.left, short.spent], [3, 7, 0.03])
  // What it wrote says what a call costs, so the next run counts ahead.
  ok(counted[0].includes('about $0.09 at list price'), counted[0])
  equal([rest.asked, rest.left, capped.asked.length], [9, 0, 12])
})

// A run stopped while its first writer works; the writer returns after the
// run is gone, and the next run reads it.
let cut = await open()
let stop = new AbortController()
let stopped = await run(cut.g, cut.round, {
  cap: 1,
  jobs: 1,
  signal: stop.signal,
  pause: () => Promise.resolve(stop.abort()),
})
await cut.answer()
let resumed = await run(cut.g, cut.round, { cap: 1, pause: cut.answer })

test('a run stopped while a writer works reads that session later and does not ask again', () => {
  equal([stopped.asked, stopped.returned], [1, 0])
  equal(resumed.returned, 12)
  equal([resumed.asked, cut.asked.length], [11, 12])
})

// A model whose first reply holds no pitch.
let garbled = await open()
let once = true
let sorry: string[] = []
let failed = await run(garbled.g, garbled.round, {
  cap: 1,
  jobs: 1,
  out: (line) => sorry.push(line),
  pause: async () => {
    await garbled.answer()
    if (!once) return
    once = false
    let [first] = await garbled.g.read('.output .content *') as Any[]
    await garbled.g.apply([{
      entity: first.entity,
      content: { body: 'Sorry.' },
    }])
  },
})
let kept = (await comps(garbled.g, garbled.round, 'writing')).length
let retried = await run(garbled.g, garbled.round, {
  cap: 1,
  pause: garbled.answer,
})

test('a reply with nothing readable leaves the row for the next run to ask again', async () => {
  equal([failed.asked, failed.failed, kept], [10, 1, 3])
  ok(sorry.some((l) => l.includes('nothing readable (Sorry.)')), sorry[1])
  equal([retried.asked, retried.failed], [3, 0])
  equal((await comps(garbled.g, garbled.round, 'guess')).length, 8)
  equal(await find(garbled.g, 'r2'), garbled.round)
})
