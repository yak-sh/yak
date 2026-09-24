// The runner, end to end over a graph: what a host's call records, what the
// claim stops, what a throw lands, whose name the tool writes in — and the
// same rules registered as effects, which is how a call nobody is waiting on
// (one another process wrote, one that was scheduled) gets run.

import { assertEquals, assertRejects } from '@std/assert'
import {
  argsOf,
  type Bundle,
  type Comp,
  graph,
  Refused,
  type Tool,
} from '@yaks/graph'
import { effects } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  callDoc,
  CallError,
  faulted,
  runner,
  toolDoc,
  toolEid,
  UnfinishedCall,
} from './mod.ts'

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
  run: (call) => [{
    entity: { eid: '$said' },
    content: { body: `${argsOf(call).value} ${argsOf(call).count}` },
    output: { source: call.entity.eid },
  }],
}

let words = (extra: Record<string, unknown> = {}) =>
  loadVocab([callDoc, toolDoc, {
    $defs: {
      person: { component: true, properties: {} },
      // What a runner's owner is: a process, and its ending (@yaks/process).
      process: { component: true, properties: { pid: { type: 'integer' } } },
      exit: { component: true, properties: { code: { type: 'integer' } } },
      created: {
        component: true,
        properties: {
          by: { type: 'string', ref: 'entity', death: 'keep' },
          at: { type: 'string', format: 'date-time', stamped: true },
        },
      },
      ...extra,
    },
  }])

let world = (tools: Tool[] = [echo], owner?: string) => {
  let vocab = words()
  let g = graph({ vocab, storage: ram(vocab) })
  return { g, r: runner(g, { tools, owner, report: () => {} }) }
}

// The same graph with the runner's rules registered as effects: one
// registration each, and then a call is run because it was written, not
// because somebody awaited it.
let watched = (tools: Tool[] = [echo], extra = {}) => {
  let vocab = words(extra)
  let fx = effects(vocab, { report: () => {} })
  let g = graph({ vocab, storage: ram(vocab), plugins: [fx] })
  let r = runner(g, { tools, report: () => {} })
  for (let rule of r.rules) fx.on(rule.plan, (e) => r.run(e.entity.eid))
  return { g, r, fx }
}

let called = (
  to: string,
  args: Record<string, unknown> = {},
  by?: string,
): Bundle[] => [{
  entity: { eid: '$call' },
  call: { to: toolEid(to), args },
  ...(by ? { $actor: { by } } : {}),
}]

let body = (b: Bundle | undefined) => String((b?.content as Comp)?.body ?? '')

Deno.test('a call is the transcript: the ask, the answer, the result beside it', async () => {
  let { g, r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo', { value: 'hi' }))
  let result = answer.find((b) => b.result)!
  assertEquals(body(answer.find((b) => b.output)), 'hi 2')
  assertEquals(body(result), 'hi 2')
  assertEquals(typeof (result.result as Comp).ms, 'number')
  assertEquals((await g.read('.execution'))[0].execution, { state: 'done' })
  // The result is the rule's own entity, so answering again is the same one.
  let again = await r.run((await g.read('.call'))[0].entity.eid)
  assertEquals(again.find((b) => b.result)!.entity.eid, result.entity.eid)
})

Deno.test('a claim is a claim: a second run of a call in flight is the same run', async () => {
  let { g, r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo', { value: 'one' }))
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
    call: { to: toolEid('example_echo'), args: { value: 'late' } },
    execution: { state: 'running' },
  }])
  await assertRejects(() => r.run(call.entity.eid), UnfinishedCall)
  assertEquals(
    body((await r.drive({ redrive: true })).find((b) => b.result)),
    'late 2',
  )
})

Deno.test('a call somebody else holds is left alone, redrive and all', async () => {
  // What an imported transcript looks like: every call in it was made by the
  // process that recorded it, and it says so.
  let { g, r } = world([echo], 'host1')
  await r.ensure()
  await g.apply([{
    entity: { eid: 'theirs' },
    call: { to: toolEid('example_echo'), args: { value: 'elsewhere' } },
    execution: { state: 'running', by: 'host2' },
  }, {
    entity: { eid: 'mine' },
    call: { to: toolEid('example_echo'), args: { value: 'here' } },
    execution: { state: 'running', by: 'host1' },
  }])
  assertEquals(await r.run('theirs'), [])
  assertEquals(
    body((await r.drive({ redrive: true })).find((b) => b.result)),
    'here 2',
  )
  assertEquals((await g.read('.result')).length, 1)
  // And this runner's own claim says whose it is, still, once it is done.
  assertEquals((await g.read('.execution.by=host1'))[0].execution, {
    state: 'done',
    by: 'host1',
  })
})

Deno.test('a claim whose holder has exited is free, and runs once', async () => {
  // What a crash leaves now that a process is an entity: the holder is still
  // named, and it wears the ending it wrote on the way out.
  let { g, r } = world([echo], 'host1')
  await r.ensure()
  await g.apply([
    { entity: { eid: 'crashed' }, process: { pid: 1 }, exit: { code: 1 } },
    { entity: { eid: 'alive' }, process: { pid: 2 } },
    {
      entity: { eid: 'orphan' },
      call: { to: toolEid('example_echo'), args: { value: 'again' } },
      execution: { state: 'running', by: 'crashed' },
    },
    {
      entity: { eid: 'theirs' },
      call: { to: toolEid('example_echo'), args: { value: 'elsewhere' } },
      execution: { state: 'running', by: 'alive' },
    },
  ])
  // An ordinary drive — no boot pass, no redrive — takes the lapsed claim.
  let ran = await r.drive()
  assertEquals(ran.filter((b) => b.result).length, 1)
  assertEquals(body(ran.find((b) => b.result)), 'again 2')
  assertEquals((await g.read('.execution.by=host1'))[0].entity.eid, 'orphan')
  // Once: the answer stands, and the next drive finds it rather than re-running.
  assertEquals((await r.drive()).filter((b) => b.result).length, 0)
  assertEquals((await g.read('.result')).length, 1)
  // A live holder's call is still theirs.
  assertEquals(await r.run('theirs'), [])
  assertEquals((await g.read('.execution.by=alive'))[0].execution, {
    state: 'running',
    by: 'alive',
  })
})

Deno.test('a throw is an error entity, a result, and a failed execution', async () => {
  let { g, r } = world([{
    ...echo,
    run: () => {
      throw new Error('no')
    },
  }])
  await r.ensure()
  let answer = await r.call(called('example_echo', { value: 'x' }))
  let fault = answer.find((b) => b.exception)!
  assertEquals(
    (fault.output as Comp).source,
    (await g.read('.call'))[0].entity.eid,
  )
  assertEquals(body(fault), 'Error: no')
  assertEquals(answer.find((b) => b.result)!.result !== undefined, true)
  assertEquals((await g.read('.execution'))[0].execution, { state: 'failed' })
})

Deno.test('a defect is reported with its tool; a refusal is not', async () => {
  let said: [unknown, string | undefined][] = []
  let vocab = words()
  let g = graph({ vocab, storage: ram(vocab) })
  let throwing = (verb: string, e: Error): Tool => ({
    ...echo,
    verb,
    run: () => {
      throw e
    },
  })
  let broke = new TypeError('x is undefined')
  let r = runner(g, {
    tools: [
      throwing('broke', broke),
      throwing('refuse', new CallError('member', 'not a member')),
      throwing('named', new Refused("no component 'bok'")),
    ],
    report: (err, _call, tool) => said.push([err, tool]),
  })
  await r.ensure()
  await r.call(called('example_refuse', { value: 'x' }))
  // A graph refusal is the caller's too, recorded under its own name.
  let named = await r.call(called('example_named', { value: 'x' }))
  assertEquals(named.find((b) => b.error)?.error, { code: 'Refused' })
  assertEquals(said, [])
  await r.call(called('example_broke', { value: 'x' }))
  assertEquals(said, [[broke, 'example_broke']])
})

Deno.test('a batch the graph refuses is the call failing, not a call left claimed', async () => {
  let { g, r } = world([{
    ...echo,
    run: () => [{ entity: { eid: '$nope' }, person: { nosuch: 1 } }],
  }])
  await r.ensure()
  let answer = await r.call(called('example_echo', { value: 'x' }))
  assertEquals(answer.some((b) => b.exception || b.error), true)
  assertEquals((await g.read('.execution'))[0].execution, { state: 'failed' })
  assertEquals((await g.read('.result')).length, 1)
})

Deno.test('a tool that ANSWERS a fault has not failed', async () => {
  let { g, r } = world([{
    ...echo,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    // A listing of what broke: entities wearing the very words a failure
    // wears. The runner's own `execution` is what says whether the call
    // failed, so a host reads that and not the shape of the answer.
    run: (_, g) => g.read('.error'),
  }])
  await r.ensure()
  await g.apply([{ entity: { eid: 'b1' }, error: { code: 'broke' } }])
  let landed = await r.call(called('example_echo'))
  assertEquals(landed.some((b) => b.error), true)
  assertEquals(faulted(landed), false)
})

Deno.test('a reading tool answers entities and writes none of them', async () => {
  let { g, r } = world([{
    ...echo,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: (_, g) => g.read('.person'),
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
  let answer = await r.call(called('example_echo'))
  assertEquals((answer.find((b) => b.error)!.error as Comp).code, 'arguments')
})

Deno.test("a tool writes in the CALLER's name, never the runner's", async () => {
  let { g, r } = world()
  await r.ensure()
  await g.apply([{ entity: { eid: 'p1' }, person: {} }])
  await r.call(called('example_echo', { value: 'mine' }, 'p1'))
  let [said] = await g.read('.output')
  assertEquals((said.created as Comp).by, 'p1')
})

Deno.test('two runners over one graph are one claimant and one answer', async () => {
  let { g, r, fx } = watched()
  await r.ensure()
  // A door's runner beside a daemon's. The effect runs the call the moment it
  // is written; the runner that wrote it still reads back what was landed,
  // and the tool ran once between them.
  let other = runner(g, { tools: [echo] })
  for (let rule of other.rules) fx.on(rule.plan, (e) => other.run(e.entity.eid))
  let answer = await other.call(called('example_echo', { value: 'both' }))
  assertEquals(body(answer.find((b) => b.output)), 'both 2')
  assertEquals((await g.read('.result')).length, 1)
})

Deno.test('a call somebody else wrote is run because an effect matched it', async () => {
  let { g, r } = watched()
  await r.ensure()
  // Nobody awaits this: it is a plain write, by a plain writer.
  await g.apply([{
    entity: { eid: 'c9' },
    call: { to: toolEid('example_echo'), args: { value: 'elsewhere' } },
  }])
  assertEquals(body((await g.read('.result'))[0]), 'elsewhere 2')
  assertEquals((await g.read('.execution'))[0].execution, { state: 'done' })
})

Deno.test('a call for a tool this runner has no word for is left alone', async () => {
  let { g, r } = watched()
  await r.ensure()
  await g.apply([{
    entity: { eid: 'c2' },
    call: { to: toolEid('somebody_else'), args: {} },
  }])
  assertEquals((await r.drive()).length, 0)
  assertEquals((await g.read('.result')).length, 0)
  assertEquals((await g.read('.execution')).length, 0)
})

let clock = {
  wake: {
    component: true,
    properties: {
      at: { type: 'string', format: 'date-time' },
      every: { type: 'string' },
    },
  },
  fired: {
    component: true,
    properties: { at: { type: 'string', format: 'date-time' } },
  },
}

Deno.test('a call waiting on a wake that has not fired is not this tick', async () => {
  let { g, r } = watched([echo], clock)
  await r.ensure()
  // Written, and sleeping: the ready rule says `!wake` and this one wears it.
  await g.apply([{
    entity: { eid: 'later' },
    call: { to: toolEid('example_echo'), args: { value: 'soon' } },
    wake: { at: '2030-01-01T00:00:00.000Z' },
  }])
  assertEquals((await g.read('.result')).length, 0)
  // Fired — and the second registration, which is the whole of the scheduled
  // case, selects it.
  await g.apply([{
    entity: { eid: 'later' },
    fired: { at: '2030-01-01T00:00:00.000Z' },
  }])
  assertEquals(body((await g.read('.result'))[0]), 'soon 2')
})

Deno.test('a recurring call is a standing ask: one invocation per firing', async () => {
  let { g, r } = watched([echo], clock)
  await r.ensure()
  // The schedule: a call that wears a recurrence. It is never answered
  // itself — each firing writes its own call, so the row keeps asking.
  await g.apply([{
    entity: { eid: 'daily' },
    call: { to: toolEid('example_echo'), args: { value: 'tick' } },
    wake: { at: '2030-01-01T00:00:00.000Z', every: '1d' },
  }])
  assertEquals((await g.read('.result')).length, 0)
  for (let at of ['2030-01-01T00:00:00.000Z', '2030-01-02T00:00:00.000Z']) {
    await g.apply([{ entity: { eid: 'daily' }, fired: { at } }])
  }
  // Two firings, two calls of their own, two results — and the schedule has
  // neither a result nor a claim on it.
  let made = await g.read('.call.source=daily')
  assertEquals(made.length, 2)
  assertEquals((await g.read('.result')).length, 2)
  assertEquals((await g.read('.result.call=daily')).length, 0)
  assertEquals((await g.read('.execution.state=done')).length, 2)
  // The same firing twice is the same call: an instant names one invocation.
  await g.apply([{
    entity: { eid: 'daily' },
    fired: { at: '2030-01-02T00:00:00.000Z' },
  }])
  assertEquals((await g.read('.call.source=daily')).length, 2)
})
