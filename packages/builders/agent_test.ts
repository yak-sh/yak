import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import type { Runner } from '@yaks/tools'
import type { VocabDoc } from '@yaks/vocab'
import { line } from '@yaks/query'
import { agentTool, agentToolEid, reply, waiting } from './agent.ts'
import { code } from './code.ts'
import { shop } from './testing.ts'

let tasks: VocabDoc = {
  $defs: {
    task: {
      component: true,
      type: 'object',
      status: { default: 'open' },
      properties: {},
    },
    cancelled: { component: true, type: 'object', properties: {} },
  },
}
// The step after the agent's: it reads the script the agent wrote.
let shoot = code({
  name: 'shoot',
  description: 'Shoot the script',
  answer: ({ binding }) => ({
    outputs: [{
      slot: 'shot',
      inputs: [binding.entities[0]],
      components: { doc: { body: `Shot: ${binding.vars.script}` } },
    }],
  }),
})
let workflow: Bundle[] = [{
  entity: { eid: 'video' },
  doc: { title: 'Lighthouse', body: 'a keeper and a storm' },
}, {
  entity: { eid: 'scripting' },
  doc: { title: 'Write the script' },
  content: { body: 'Write a short script about $about.' },
  builder: {
    query: '$v .doc.title=Lighthouse, doc.body=$about',
    to: agentToolEid(),
    immediate: true,
  },
}, {
  entity: { eid: 'shooting' },
  doc: { title: 'Shoot' },
  builder: {
    query: '.built.slot=script, built.current=true, doc.body=$script',
    to: toolEid('shoot'),
    immediate: true,
  },
}]
let script = (body: string) => [{
  slot: 'script',
  inputs: ['video'],
  components: { doc: { body } },
}]
let comp = (b: Bundle, name: string) => b[name] as Comp
// Run the agent calls the builders wrote that nothing has run yet.
let run = async (g: Graph, r: Runner) => {
  for (let c of await g.read(line`.call.to=${agentToolEid()}&*`)) {
    if (comp(c, 'execution')?.state != 'done') await r.due(c.entity.eid)
  }
}
let setUp = async () => {
  let shop_ = await shop({ tools: [shoot] }, [tasks], [agentTool()])
  await shop_.g.apply(workflow)
  await run(shop_.g, shop_.runner)
  return shop_
}

test("an agent step waits as a task for the person's agent, and its answer carries the workflow on", async () => {
  let { g, vocab, runner, failed } = await setUp()
  let [step] = await waiting(g)
  assertEquals(step.title, 'Write the script: Lighthouse')
  assertEquals(
    step.instructions,
    'Write a short script about a keeper and a storm.\n\nInputs: video',
  )
  assertEquals(step.binding.entities, ['video'])
  let [row] = await g.get([step.step])
  assertEquals(comp(row, 'task').status, 'open')
  assertEquals((await g.read('.built.current=true')).length, 0)

  await reply(g, vocab, { step: step.step, outputs: script('Waves.') }, null)
  await run(g, runner)
  assertEquals(
    (await g.read('.built.current=true&*'))
      .map((b) => comp(b, 'doc').body).toSorted(),
    ['Shot: Waves.', 'Waves.'],
  )
  assertEquals(await waiting(g), [])
  assertEquals(!!(await g.get([step.step]))[0].completed, true)
  await assertRejects(
    () => reply(g, vocab, { step: step.step, outputs: script('Again') }, null),
    Error,
    'already answered',
  )
  // Spending nothing: no call carries a cost, and no model was asked.
  assertEquals((await g.read('.cost')).length, 0)
  assertEquals((await g.read('.session')).length, 0)
  assertEquals(failed, [])
})

test('an answer breaking the contract is refused at once, and changed inputs ask again', async () => {
  let { g, vocab, runner } = await setUp()
  let [first] = await waiting(g)
  await assertRejects(
    () => reply(g, vocab, { step: first.step, outputs: [{ slot: 'x' }] }, null),
    Error,
    'each output needs inputs, components and a unique slot',
  )
  await g.apply([{ entity: { eid: 'video' }, doc: { body: 'a fog' } }])
  await run(g, runner)
  let [next] = await waiting(g)
  assertEquals(
    next.instructions.startsWith('Write a short script about a fog.'),
    true,
  )
  assertEquals(!!(await g.get([first.step]))[0].cancelled, true)
  await assertRejects(
    () => reply(g, vocab, { step: first.step, outputs: script('Old') }, null),
    Error,
    'superseded',
  )
})

test('a step the store refused is offered again with the reason', async () => {
  let { g, vocab, runner } = await setUp()
  let [step] = await waiting(g)
  await reply(g, vocab, {
    step: step.step,
    outputs: [{
      slot: 'script',
      inputs: ['video'],
      components: {},
      artifact: 'no-such-file',
    }],
  }, null)
  await run(g, runner)
  let [again] = await waiting(g)
  assertEquals(again.step, step.step)
  assertEquals(again.failed, 'script names a missing artifact')
  await reply(g, vocab, { step: step.step, outputs: script('Fixed.') }, null)
  assertEquals(await waiting(g), [])
})
