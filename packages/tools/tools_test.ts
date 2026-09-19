// The runner, end to end over a graph: what the rule selects, what the claim
// stops, what a throw lands, and whose name the tool writes in.

import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, graph, type Tool } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { callDoc, runner, toolDoc, toolEid, UnfinishedCall } from './mod.ts'

let echo: Tool = {
  noun: 'example',
  verb: 'echo',
  description: 'Echo a value',
  inputSchema: {
    type: 'object',
    required: ['value'],
    properties: {
      value: { type: 'string' },
      count: { type: 'integer', default: 2 },
    },
  },
  run: (_, ctx) => [{
    entity: { eid: '$said' },
    content: { body: `${ctx.args.value} ${ctx.args.count}` },
    output: { source: ctx.call },
  }],
}

let world = (tools: Tool[] = [echo]) => {
  let vocab = loadVocab([callDoc, toolDoc, {
    $defs: {
      person: { component: true, properties: {} },
      created: {
        component: true,
        properties: {
          by: { type: 'string', ref: 'entity', death: 'keep' },
          at: { type: 'string', format: 'date-time', stamped: true },
        },
      },
    },
  }])
  let g = graph({ vocab, storage: ram(vocab) })
  let r = runner(g, { tools, report: () => {} })
  g.use(r.plugin)
  return { g, r }
}

let called = (
  to: string,
  args = '{}',
  by?: string,
): Bundle[] => [{
  entity: { eid: '$call' },
  call: { to: toolEid(to), args },
  ...(by ? { $actor: { by } } : {}),
}]

let body = (b: Bundle | undefined) => String((b?.content as Comp)?.body ?? '')

Deno.test('a call written is a call run: the rule finds it and the result is attached', async () => {
  let { g, r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo', '{"value":"hi"}'))
  let result = answer.find((b) => b.result)!
  assertEquals(body(answer.find((b) => b.output)), 'hi 2')
  assertEquals(body(result), 'hi 2')
  assertEquals(typeof (result.result as Comp).ms, 'number')
  assertEquals((await g.read('.execution'))[0].execution, { state: 'done' })
  // The result is the RULE's own entity, so answering again is the same one.
  let again = await r.run((await g.read('.call'))[0].entity.eid)
  assertEquals(again.find((b) => b.result)!.entity.eid, result.entity.eid)
})

Deno.test('a claim is a claim: a second run of a call in flight is the same run', async () => {
  let { g, r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo', '{"value":"one"}'))
  let call = (await g.read('.call'))[0].entity.eid
  // The answer stands; a re-entry reads it back rather than running again.
  assertEquals(body((await r.run(call)).find((b) => b.result)), 'one 2')
  assertEquals((await g.read('.result')).length, 1)
  assertEquals(answer.filter((b) => b.result).length, 1)
})

Deno.test('a claim with no answer is unfinished, and the boot pass re-drives it', async () => {
  let { g, r } = world()
  await r.ensure()
  let [call] = await g.apply([{
    entity: { eid: 'c1' },
    call: { to: toolEid('example_echo'), args: '{"value":"late"}' },
    execution: { state: 'running' },
  }])
  await assertRejects(() => r.run(call.entity.eid), UnfinishedCall)
  assertEquals(
    body((await r.drive({ redrive: true })).find((b) => b.result)),
    'late 2',
  )
})

Deno.test('a throw is an error entity, a result, and a failed execution', async () => {
  let { g, r } = world([{
    ...echo,
    run: () => {
      throw new Error('no')
    },
  }])
  await r.ensure()
  let answer = await r.call(called('example_echo', '{"value":"x"}'))
  let fault = answer.find((b) => b.exception)!
  assertEquals(
    (fault.output as Comp).source,
    (await g.read('.call'))[0].entity.eid,
  )
  assertEquals(body(fault), 'Error: no')
  assertEquals(answer.find((b) => b.result)!.result !== undefined, true)
  assertEquals((await g.read('.execution'))[0].execution, { state: 'failed' })
})

Deno.test('a batch the graph refuses is the call failing, not a call left claimed', async () => {
  let { g, r } = world([{
    ...echo,
    run: () => [{ entity: { eid: '$nope' }, person: { nosuch: 1 } }],
  }])
  await r.ensure()
  let answer = await r.call(called('example_echo', '{"value":"x"}'))
  assertEquals(answer.some((b) => b.exception || b.error), true)
  assertEquals((await g.read('.execution'))[0].execution, { state: 'failed' })
  assertEquals((await g.read('.result')).length, 1)
})

Deno.test('a reading tool answers entities and writes none of them', async () => {
  let { g, r } = world([{
    ...echo,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: (_, ctx) => ctx.read('.person'),
  }])
  await r.ensure()
  await g.apply([{ entity: { eid: 'p1' }, person: {} }])
  let before = (await g.read('.person'))[0]
  let answer = await r.call(called('example_echo'))
  assertEquals(answer.find((b) => b.person)!.entity.eid, 'p1')
  // The row it found is the row it was: a read does not touch what it read.
  assertEquals((await g.read('.person'))[0], before)
})

Deno.test('a refused argument is an error code, not an exception', async () => {
  let { r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo', '{}'))
  assertEquals((answer.find((b) => b.error)!.error as Comp).code, 'arguments')
})

Deno.test("a tool writes in the CALLER's name, never the runner's", async () => {
  let { g, r } = world()
  await r.ensure()
  await g.apply([{ entity: { eid: 'p1' }, person: {} }])
  await r.call(called('example_echo', '{"value":"mine"}', 'p1'))
  let [said] = await g.read('.output')
  assertEquals((said.created as Comp).by, 'p1')
})

Deno.test('two runners over one graph are one claimant and one answer', async () => {
  let { g, r } = world()
  await r.ensure()
  // A second runner over the same graph — a door's beside a daemon's. Only
  // the first is registered, so the effect runs the call there; the second is
  // the one that wrote it and still reads what was landed for it.
  let other = runner(g, { tools: [echo] })
  let answer = await other.call(called('example_echo', '{"value":"both"}'))
  assertEquals(body(answer.find((b) => b.output)), 'both 2')
  assertEquals((await g.read('.result')).length, 1)
})

Deno.test('a call for a tool this runner has no word for is left alone', async () => {
  let { g, r } = world()
  await r.ensure()
  await g.apply([{
    entity: { eid: 'c2' },
    call: { to: toolEid('somebody_else'), args: '{}' },
  }])
  assertEquals((await g.read('.result')).length, 0)
  assertEquals((await g.read('.execution')).length, 0)
})

Deno.test('a call waiting on a wake that has not fired is not this tick', async () => {
  let vocab = loadVocab([callDoc, toolDoc, {
    $defs: {
      wake: {
        component: true,
        properties: { at: { type: 'string', format: 'date-time' } },
      },
      fired: {
        component: true,
        properties: { at: { type: 'string', format: 'date-time' } },
      },
    },
  }])
  let g = graph({ vocab, storage: ram(vocab) })
  let r = runner(g, { tools: [echo] })
  g.use(r.plugin)
  await r.ensure()
  await g.apply([{
    entity: { eid: 'later' },
    call: { to: toolEid('example_echo'), args: '{"value":"soon"}' },
    wake: { at: '2030-01-01T00:00:00.000Z' },
  }])
  assertEquals((await g.read('.result')).length, 0)
  // Fired, and the same rule that left it alone now selects it.
  await g.apply([{
    entity: { eid: 'later' },
    fired: { at: '2030-01-01T00:00:00.000Z' },
  }])
  assertEquals(body((await r.drive()).find((b) => b.result)), 'soon 2')
})
