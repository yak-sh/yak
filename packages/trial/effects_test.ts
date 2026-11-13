// A skill improved by trials where no session runs: a round planned from its
// file, priced, run by setting its cap through a model asked directly, held
// to that cap across runs, and its winner made the skill's next version.

import { equal, ok, test } from '@yaks/testing'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { signed } from '@yaks/graph/provenance'
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { effects } from '@yaks/effects'
import { kernelDoc } from '@yaks/kernel/vocab'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { type Model, ModelError } from '@yaks/model'
import { modelDoc } from '@yaks/model/vocab'
import { personaDoc } from '@yaks/persona'
import { processDoc } from '@yaks/process'
import { ram } from '@yaks/ram'
import { sessionDoc } from '@yaks/session'
import { CallError } from '@yaks/tools/errors'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { running } from './effects.ts'
import { gather } from './round.ts'
import { type Answering, asking, type Ran } from './run.ts'
import type { RoundFile } from './skill.ts'
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
], [keyKeywords])

let file: RoundFile = {
  key: 'w1',
  title: 'Shorter pitches',
  skill: 'pitching',
  output: ['headline'],
  using: { provider: 'fake', model: 'fake-1' },
  writers: { task: 'Pitch $case', skilled: 'Follow:\n$skill\nPitch $case' },
  variants: [
    { key: 'now', title: 'As it is', body: 'write long' },
    { key: 'short', title: 'Shorter', body: 'write short', from: 'now' },
  ],
  cases: [
    { key: 'bakery', title: 'Bakery', body: 'a bakery' },
    { key: 'gym', title: 'Gym', body: 'a gym' },
  ],
  plan: {
    variants: ['now', 'short'],
    cases: ['bakery', 'gym'],
    personas: [false],
    paired: true,
  },
}

let block = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```'

// A model at a cent a call, which names the skill it followed; `refuse`
// makes it refuse instead, as a spent budget does.
let fake = (o: { refuse?: () => Error | undefined } = {}) => {
  let asked: Any[] = []
  let model: Model = (req) => {
    let no = o.refuse?.()
    if (no) return Promise.reject(no)
    asked.push(req)
    let text = (req.items[0] as { text: string }).text
    return Promise.resolve({
      id: 'r',
      model: req.model,
      items: [{
        kind: 'assistant',
        text: block({ headline: text.includes('short') ? 'Short' : 'Long' }),
      }],
      usage: { input_tokens: 100, output_tokens: 20 },
      cost: 0.01,
    })
  }
  let named: Any[] = []
  let answering: Answering = (names) => {
    named.push(names)
    return Promise.resolve({
      model,
      name: names.model!,
      price: { input: 1, output: 2 },
    })
  }
  return { asked, named, answering }
}

// A graph with the skill kept under its title, the tools as a member of the
// space calls them, and `round_run` handled by a model asked directly.
let open = async (model = fake()) => {
  let fx = effects(vocab)
  let g: Graph = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [keys(vocab), aliases(), fx],
  })
  await g.install()
  await g.apply([{
    entity: { eid: 'skill' },
    skill: {},
    doc: { title: 'pitching', body: 'Use for pitches.' },
    content: { body: 'write long' },
  }])
  let ran: Ran[] = []
  let going: Promise<unknown>[] = []
  let handled = running(g, () => asking(g, model.answering), {
    done: (_, r) => ran.push(r),
  })
  fx.handle({
    round_run: (...args) => {
      let p = Promise.resolve(handled.round_run(...args))
      going.push(p)
      return p
    },
  })
  let space = { by: 'space' }
  await g.apply([{ entity: { eid: 'space' }, doc: { title: 'A space' } }])
  let tool = async (name: string, args: Record<string, unknown>) => {
    // The runner applies what a tool answers, less its words, as the caller.
    let out: Bundle[] = await runs({
      asking: () => asking(g, model.answering),
      notice: (round) => `Cases of ${(round.round as Any).skill} go public.`,
    })[name]!(
      { entity: { eid: crypto.randomUUID() }, call: { args }, $actor: space },
      g,
    ) as Bundle[]
    let rows = out.filter((b) => !b.output)
    if (rows.length) await g.apply(signed(rows, space))
    await Promise.all(going)
    return String((out.find((b) => b.output)?.content as Any)?.body)
  }
  let comps = async (name: string): Promise<Any[]> =>
    (await gather(g, (await g.address(['round:w1'])).get('round:w1')!))
      .filter((b) => b[name])
  return { g, tool, comps, ran, model }
}

test('a plan writes no results, and plans its pairs on the skill kept under its title', async () => {
  let t = await open()
  let refused = await t.tool('trial_plan', {
    round: {
      ...file,
      attempts: [{
        key: 'x',
        case: 'bakery',
        variant: 'now',
        persona: false,
        output: { headline: 'Mine' },
      }],
    },
  }).catch((e) => e.message)
  ok(refused.includes('only a run writes'), refused)
  let said = await t.tool('trial_plan', { round: file })
  ok(said.startsWith('w1 is planned: 4 attempts, 0 guesses and 2 pairs'), said)
  // Whoever brings the cases hears the host's notice before the round runs.
  ok(
    said.endsWith(
      'trial_cap says what it will cost. Cases of skill go public.',
    ),
    said,
  )
  let [round] = await t.comps('round')
  equal(round.round.skill, 'skill')
  // A plan is the space's, which a skill's page counts as its own run.
  ok((await t.comps('writing')).every((a) => a.created.by == 'space'))
})

test('a run says its cost first, stops at its cap, and the cap counts what was spent', async () => {
  let t = await open()
  await t.tool('trial_plan', { round: file })
  let quote = await t.tool('trial_cap', { round: 'w1', cap: 0 })
  // Priced at the model's price, at most the reply's tokens: 4 writers.
  ok(quote.startsWith('4 writers and 0 judges to ask, about $0.03'), quote)
  ok(
    quote.endsWith('so far. Give a cap to run it. Cases of skill go public.'),
    quote,
  )
  equal(t.model.asked.length, 0)

  await t.tool('trial_cap', { round: 'w1', cap: 0.025 })
  equal(t.model.named[0], { provider: 'fake', model: 'fake-1' })
  // What the calls going are held to stops it short of the cap.
  let written = (await t.comps('writing')).filter((a) => a.writing.output)
  ok(written.length >= 1 && written.length < 4, String(written.length))
  equal(t.ran[0].stopped, 'the cap')
  ok(written.every((a) => a.cost.dollars == 0.01 && a.cost.reported))

  let again = await t.tool('trial_cap', { round: 'w1', cap: 0.01 })
    .catch((e) => e.message)
  ok(again.includes('asks nothing more'), again)
  await t.tool('trial_cap', { round: 'w1', cap: 1 })
  let all = (await t.comps('writing')).map((a) => a.writing.output.headline)
  equal(all.sort(), ['Long', 'Long', 'Short', 'Short'])
  equal(t.model.asked.length, 4)
  ok(t.model.asked.every((r) => r.tools.length == 0 && r.tokens == 4000))
})

test('a refusal stops the run, and one that may pass leaves its call for the next', async () => {
  let spentOut = new CallError('limit', "The space's budget is spent")
  let n = 0
  let t = await open(fake({
    refuse: () =>
      n++ == 0
        ? new ModelError('overloaded', 'busy', { after: 1 })
        : n > 2
        ? spentOut
        : undefined,
  }))
  await t.tool('trial_plan', { round: file })
  await t.tool('trial_cap', { round: 'w1', cap: 1 })
  let [ran] = t.ran
  equal(ran.stopped, "The space's budget is spent")
  equal([ran.returned, ran.failed], [1, 1])
  let rows = await t.comps('writing')
  equal(rows.filter((a) => a.writing.output).length, 1)
})

test("the winner becomes the skill's text, and its next version", async () => {
  let t = await open()
  await t.tool('trial_plan', { round: file })
  await t.tool('trial_cap', { round: 'w1', cap: 1 })
  let said = await t.tool('trial_adopt', { round: 'w1', variant: 'short' })
  ok(said.startsWith('short is now the skill'), said)
  let [skill] = await t.g.get(['skill']) as Any[]
  equal(skill.content.body, 'write short')
  let [v] = (await t.comps('variant')).filter((b) => b.adopted)
  equal([v.variant.body, v.adopted.skill, v.adopted.by], [
    'write short',
    'skill',
    'space',
  ])
})
