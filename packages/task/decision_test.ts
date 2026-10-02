import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Comp, graph, mint } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { projectDoc } from '@yaks/project'
import { callDoc, runner, toolDoc, toolEid } from '@yaks/tools'
import { answer } from './decision.ts'
import { taskDoc } from './comp.ts'
import { tasks } from './plugin.ts'
import { openDeps } from './deps.ts'
import { statusOf } from './words.ts'
import { runs } from './tools.ts'

let ask = {
  question: 'Which route?',
  choices: [
    { label: 'Train', description: 'Arrive earlier' },
    { label: 'Bus', description: 'Spend less' },
  ],
  recommended: 'Train',
}
let world = async () => {
  let vocab = loadVocab(
    [kernelDoc, docDoc, edgeDoc, taskDoc, projectDoc, callDoc, toolDoc],
    [kernelKeywords, edgeKeywords],
  )
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [kernel(), edges(vocab), tasks()],
  })
  let r = runner(g, { tools: loadTools(taskDoc, runs()) })
  await r.ensure()
  await g.apply([{ entity: { eid: 'person' }, doc: { title: 'Reader' } }])
  let call = (name: string, args: Record<string, unknown>, by: string) =>
    r.call({
      entity: { eid: mint() },
      call: { to: toolEid(name), args },
      $actor: { by, via: by },
    })
  let row = async (eid: string) => (await g.get([eid]))[0]
  return { g, call, row }
}

for (let choice of ['Bus', 'Walk together']) {
  test(`asking and answering ${choice} releases requiring work as the answerer`, async () => {
    let { g, call, row } = await world()
    await call('decision_new', { ...ask, assignee: 'person' }, 'agent')
    let [asked] = await g.read('.decision&*')
    let eid = asked.entity.eid
    assertEquals(asked.decision, ask)
    assertEquals((asked.created as Comp).by, 'agent')
    assertEquals((asked.filed as Comp).assignee, 'person')
    await g.apply([
      { entity: { eid: 'work' }, task: {} },
      link('work', 'requires', eid),
    ])
    assertEquals(await openDeps(g, 'work'), 1)
    await call('decision_answer', { decision: eid, choice }, 'person')
    let answered = await row(eid)
    assertEquals((answered.decided as Comp).choice, choice)
    assertEquals((answered.decided as Comp).by, 'person')
    assertEquals((answered.decided as Comp).via, 'person')
    assertEquals(typeof (answered.decided as Comp).at, 'string')
    assertEquals((answered.completed as Comp).by, 'person')
    assertEquals(statusOf(g.vocab, answered), 'done')
    assertEquals(await openDeps(g, 'work'), 0)
    assertEquals(
      (await g.read('.task.status=open&*')).map((b) => b.entity.eid),
      ['work'],
    )
    let refused = await call('decision_answer', {
      decision: eid,
      choice: 'Train',
    }, 'agent')
    assertEquals(refused.some((b) => b.refusal), true)
    assertEquals((await row(eid)).decided, answered.decided)
  })
}

test('direct answers use server stamps and keep approval verdicts independent', async () => {
  let { g, call, row } = await world()
  await call('decision_new', ask, 'agent')
  let [asked] = await g.read('.decision&*')
  let eid = asked.entity.eid
  await g.apply([{
    ...answer(eid, 'Train')[0],
    decided: { choice: 'Train', by: 'owner', at: 'forged' },
    $actor: { by: 'agent', via: 'session' },
  }])
  assertEquals(
    (await row(eid)).decided && ((await row(eid)).decided as Comp).by,
    'agent',
  )
  assertEquals(((await row(eid)).decided as Comp).via, 'session')
  await g.apply([{
    entity: { eid: 'proposal' },
    task: {},
    proposed: {},
    decided: { verdict: 'approved' },
  }])
  assertEquals(statusOf(g.vocab, await row('proposal')), 'open')
})

test('invalid asks and cancelled or blank answers refuse atomically', async () => {
  let { g, call, row } = await world()
  for (
    let invalid of [
      { ...ask, choices: [ask.choices[0]] },
      { ...ask, choices: [ask.choices[0], ask.choices[0]] },
      { ...ask, recommended: 'Walk' },
      { ...ask, question: ' ' },
    ]
  ) {
    let result = await call('decision_new', invalid, 'agent')
    assertEquals(result.some((b) => b.refusal), true)
  }
  assertEquals(await g.read('.decision&*'), [])
  await call('decision_new', ask, 'agent')
  let [asked] = await g.read('.decision&*')
  let eid = asked.entity.eid
  let rejected = await call(
    'decision_answer',
    { decision: eid, choice: ' ' },
    'person',
  )
  assertEquals(rejected.some((b) => b.refusal), true)
  assertEquals((await row(eid)).completed, undefined)
  await g.apply([{ entity: { eid }, cancelled: {} }])
  rejected = await call(
    'decision_answer',
    { decision: eid, choice: 'Bus' },
    'person',
  )
  assertEquals(rejected.some((b) => b.refusal), true)
  assertEquals((await row(eid)).decided, undefined)
  await assertRejects(async () => {
    await g.apply([{ entity: { eid }, decision: { recommended: 'Walk' } }])
  })
})
