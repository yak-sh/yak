// The runner, end to end over a graph: what a host's call records, what the
// claim stops, what a throw lands, whose name the tool writes in — and the
// same rules registered as effects, which is how a call nobody is waiting on
// (one another process wrote, one that was scheduled) gets run.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import {
  argsOf,
  type Bundle,
  type Comp,
  graph,
  mint,
  Refused,
  type Tool,
} from '@yaks/graph'
import { effects } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  answerOf,
  callDoc,
  CallError,
  faulted,
  runner,
  toolDoc,
  toolEid,
  UnfinishedCall,
  worded,
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
  for (let rule of r.rules) fx.on(rule.plan, (e) => r.due(e.entity.eid))
  return { g, r, fx }
}

let called = (
  to: string,
  args: Record<string, unknown> = {},
  by?: string,
): Bundle => ({
  entity: { eid: mint() },
  call: { to: toolEid(to), args },
  ...(by ? { $actor: { by } } : {}),
})

let body = (b: Bundle | undefined) => String((b?.content as Comp)?.body ?? '')

test('a call is the transcript: the ask, the answer, the result beside it', async () => {
  let { g, r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo', { value: 'hi' }))
  let result = answer.find((b) => b.result)!
  assertEquals(body(answer.find((b) => b.output)), 'hi 2')
  assertEquals(body(result), 'hi 2')
  assertEquals(typeof (result.result as Comp).ms, 'number')
  assertEquals((await g.read('.execution&*'))[0].execution, { state: 'done' })
  // The result is the rule's own entity, so answering again is the same one.
  let again = await r.run((await g.read('.call&*'))[0].entity.eid)
  assertEquals(again.find((b) => b.result)!.entity.eid, result.entity.eid)
})

test('a direct tool reply carries what its caller is owed beside its data', async () => {
  let vocab = words()
  let g = graph({ vocab, storage: ram(vocab) })
  let data: Tool = {
    ...echo,
    run: () => [{ entity: { eid: 'datum' }, person: {} }],
  }
  let replies = 0
  let r = runner(g, {
    tools: [data],
    reply: () => (replies++,
      Promise.resolve([{
        entity: { eid: 'notice' },
        content: { body: 'new mail' },
      }])),
  })
  await r.ensure()
  let asked = called('example_echo', { value: 'hi' })
  let answer = answerOf(await r.call(asked), asked.entity.eid)
  assertEquals(answer.map((b) => b.entity.eid), ['datum', 'notice'])
  let said = worded(answer)
  assertEquals(said.includes('datum'), true)
  assertEquals(said.includes('new mail'), true)
  assertEquals((await g.get(['notice'])).length, 0)
  let [call] = await g.read('.call&*')
  await r.run(call.entity.eid)
  assertEquals(replies, 1)
})

test('a rehearsal keeps its answer in the call graph', async () => {
  let { g } = world()
  let host = {
    ...g,
    apply: () => {
      throw new Error('the answer crossed into the host')
    },
  }
  let tool: Tool = {
    ...echo,
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
        count: { type: 'integer', default: 2 },
        check: { type: 'boolean' },
      },
    },
  }
  let r = runner(g, { tools: [tool], host, report: () => {} })
  await r.ensure()
  let asked = called('example_echo', { value: 'hi', check: true })
  let answer = await r.call(asked)
  assertEquals(faulted(answer, asked.entity.eid), false)
  assertEquals(body(answerOf(answer, asked.entity.eid)[0]), 'hi 2')
  assertEquals((await g.read('.output&*')).length, 0)
})

test('a reply is told what the call wrote: the write, never a read or a rehearsal', async () => {
  let vocab = words()
  let g = graph({ vocab, storage: ram(vocab) })
  let make: Tool = {
    ...echo,
    inputSchema: { type: 'object', properties: { check: {} } },
    run: () => [{ entity: { eid: '$made' }, person: {} }],
  }
  let told: string[][] = []
  let r = runner(g, {
    tools: [make, {
      ...make,
      verb: 'list',
      readOnly: true,
      run: (_, host) => host.read('.person&*'),
    }],
    reply: (_call, _answer, wrote) => (
      told.push(wrote.map((b) => b.created ? 'created' : 'moved')),
        Promise.resolve([])
    ),
  })
  await r.ensure()
  await r.call(called('example_echo'))
  await r.call(called('example_list'))
  await r.call(called('example_echo', { check: true }))
  assertEquals(told, [['created'], [], []])
})

test('a refused tool still carries what its caller is owed', async () => {
  let vocab = words()
  let g = graph({ vocab, storage: ram(vocab) })
  let refused: Tool = {
    ...echo,
    run: () => {
      throw new CallError('refused', 'try again')
    },
  }
  let r = runner(g, {
    tools: [refused],
    reply: () =>
      Promise.resolve([{
        entity: { eid: 'notice' },
        content: { body: 'new mail' },
      }]),
  })
  await r.ensure()
  let asked = called('example_echo', { value: 'hi' })
  let landed = await r.call(asked)
  assertEquals(faulted(landed, asked.entity.eid), true)
  assertEquals(
    worded(answerOf(landed, asked.entity.eid)).includes('new mail'),
    true,
  )
})

test('a runner writes only the tool rows the graph lacks or holds otherwise', async () => {
  let { g, r } = world()
  assertEquals((await r.ensure()).length, 1)
  assertEquals(await runner(g, { tools: [echo] }).ensure(), [])
  let moved = { ...echo, description: 'Echo a value back' }
  let [row] = await runner(g, { tools: [moved] }).ensure()
  assertEquals((row.tool as Comp).description, 'Echo a value back')
})

test('a runner told which tool a call points at writes that row alone', async () => {
  let { g } = world()
  let shout = { ...echo, verb: 'shout', description: 'Echo it loudly' }
  let r = runner(g, { tools: [echo, shout] })
  let tools = async () => (await g.read('.tool&*')).map((b) => b.tool as Comp)
  await r.ensure(['example_shout'])
  assertEquals((await tools()).map((t) => t.name), ['example_shout'])
  assertEquals(
    await r.ensure(['example_shout']),
    await r.ensure(['example_shout']),
  )
  await r.ensure()
  assertEquals((await tools()).map((t) => t.name).sort(), [
    'example_echo',
    'example_shout',
  ])
})

test('a claim is a claim: a second run of a call in flight is the same run', async () => {
  let { g, r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo', { value: 'one' }))
  let call = (await g.read('.call&*'))[0].entity.eid
  // The answer stands; a re-entry reads it back rather than running again.
  assertEquals(body((await r.run(call)).find((b) => b.result)), 'one 2')
  assertEquals((await g.read('.result&*')).length, 1)
  assertEquals(answer.filter((b) => b.result).length, 1)
})

test('a claim with no answer is unfinished, and the boot pass re-drives it', async () => {
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

test('interrupting an unstarted call answers it once without running the tool', async () => {
  let runs = 0
  let { g, r } = world([{
    ...echo,
    run: (call, graph) => (runs++, echo.run(call, graph)),
  }])
  await r.ensure()
  await g.apply([{
    entity: { eid: 'unstarted' },
    call: { to: toolEid('example_echo'), args: { value: 'skip' } },
  }])
  let first = await r.interruptCall('unstarted', 'superseded before execution')
  let again = await r.interruptCall('unstarted', 'superseded before execution')
  assertEquals(runs, 0)
  assertEquals(first.filter((b) => b.result).length, 1)
  assertEquals(first.filter((b) => b.error).length, 1)
  assertEquals((await g.read('.result&*')).length, 1)
  assertEquals((await g.read('.execution&*'))[0].execution, { state: 'failed' })
  assertEquals(
    again.find((b) => b.result)?.entity.eid,
    first.find((b) => b.result)?.entity.eid,
  )
  assertEquals(await r.drive(), [])
  assertEquals(runs, 0)
})

test('a call a live process holds is left alone, redrive and all', async () => {
  // What an imported transcript looks like: every call in it was made by the
  // process that recorded it, and it says so. This process's own claim, not
  // running in this runner, is running in another of its threads.
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
  assertEquals(await r.run('mine'), [])
  assertEquals(await r.drive({ redrive: true }), [])
  assertEquals((await g.read('.result&*')).length, 0)
})

test('a call is held from the moment it is written, by whoever asked it', async () => {
  // Another thread of this process, and another process: runners over graphs
  // of their own on the same store, sharing nothing in memory, and each
  // finding the call the moment it commits. The tool reads, so its answer is
  // never written down: only the runner that asked has it.
  let vocab = words()
  let storage = ram(vocab)
  let fx = effects(vocab, { report: () => {} })
  let here = graph({ vocab, storage, plugins: [fx] })
  let there = graph({ vocab, storage })
  let ran = 0
  let peek: Tool = {
    ...echo,
    readOnly: true,
    run: (call, g) => (ran++, echo.run(call, g)),
  }
  for (let owner of ['host1', 'host2']) {
    let other = runner(there, { tools: [peek], owner })
    for (let rule of other.rules) {
      fx.on(rule.plan, (e) => other.due(e.entity.eid))
    }
  }
  let asking = runner(here, { tools: [peek], owner: 'host1' })
  await asking.ensure()
  let answer = await asking.call(called('example_echo', { value: 'mine' }))
  assertEquals(body(answer.find((b) => b.output)), 'mine 2')
  assertEquals(ran, 1)
})

test('a claim whose holder has exited is free, and runs once', async () => {
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
  assertEquals((await g.read('.execution.by=host1&*'))[0].entity.eid, 'orphan')
  // Once: the answer stands, and the next drive finds it rather than re-running.
  assertEquals((await r.drive()).filter((b) => b.result).length, 0)
  assertEquals((await g.read('.result&*')).length, 1)
  // A live holder's call is still theirs.
  assertEquals(await r.run('theirs'), [])
  assertEquals((await g.read('.execution.by=alive&*'))[0].execution, {
    state: 'running',
    by: 'alive',
  })
})

test('an interrupted call is answered as interrupted, and no sweep runs it again', async () => {
  let hang = Promise.withResolvers<Bundle[]>()
  let stuck: Tool = { ...echo, verb: 'wait', run: () => hang.promise }
  let { g, r } = world([echo, stuck], 'host1')
  await r.ensure()
  let asked = r.call(called('example_wait', { value: 'forever' }))
  await r.call(called('example_echo', { value: 'done' }))
  let [ended] = (await r.interrupt('the process was stopped'))
    .filter((b) => b.error)
  assertEquals((ended.error as Comp).code, 'interrupted')
  assertEquals((await g.read('.execution.state=failed&*')).length, 1)
  // Its holder exiting now leaves nothing lapsed to take.
  await g.apply([{ entity: { eid: 'host1' }, process: { pid: 1 }, exit: {} }])
  assertEquals(await runner(g, { tools: [stuck], owner: 'host2' }).drive(), [])
  hang.resolve([])
  await assertRejects(() => asked)
})

test('a holder that died is interrupted for, from what the graph says it held', async () => {
  let { g, r } = world([echo], 'host1')
  await r.ensure()
  await g.apply([{
    entity: { eid: 'orphan' },
    call: { to: toolEid('example_echo'), args: { value: 'lost' } },
    execution: { state: 'running', by: 'dead' },
  }])
  let said = await r.interrupt('its process died', 'dead')
  assertEquals(said.filter((b) => b.error).length, 1)
  assertEquals((await g.read('.execution&*'))[0].execution, {
    state: 'failed',
    by: 'dead',
  })
})

test('a throw is an error entity, a result, and a failed execution', async () => {
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
    (await g.read('.call&*'))[0].entity.eid,
  )
  assertEquals(body(fault), 'Error: no')
  assertEquals(answer.find((b) => b.result)!.result !== undefined, true)
  assertEquals((await g.read('.execution&*'))[0].execution, { state: 'failed' })
})

for (let readOnly of [false, true]) {
  test(`a completed answer survives storage contention (${readOnly})`, async () => {
    using time = new FakeTime()
    let { g } = world()
    let runs = 0, attempts = 0, now = 0
    let reports: unknown[] = [], changes: Bundle[][] = []
    let busy = Object.assign(new Error('storage unavailable'), {
      retryable: true,
    })
    let tool: Tool = {
      ...echo,
      readOnly,
      run: (call, graph) => {
        runs++
        now = 7
        return echo.run(call, graph)
      },
    }
    let r = runner(g, {
      tools: [tool],
      now: () => now,
      report: (e) => void reports.push(e),
    })
    await r.ensure()
    let apply = g.apply
    g.apply = (b, opts) => {
      if (b.some((one) => one.result)) {
        changes.push(b)
        if (++attempts <= 2) throw busy
      }
      return apply(b, opts)
    }
    let call = called('example_echo', { value: 'precious' })
    let pending = r.call(call)
    await time.runMicrotasks()
    assertEquals(reports, [busy])
    now = 100
    await time.tickAsync(1000)
    await time.runMicrotasks()
    await time.tickAsync(2000)
    let answer = await pending
    assertEquals([runs, attempts], [1, 3])
    assertEquals(changes.every((b) => b === changes[0]), true)
    assertEquals(body(answer.find((b) => b.output)), 'precious 2')
    assertEquals(answer.some((b) => b.exception || b.error), false)
    assertEquals((answer.find((b) => b.result)!.result as Comp).ms, 7)
    assertEquals((await g.get([call.entity.eid]))[0].execution, {
      state: 'done',
    })
  })
}

test('a defect is reported with its tool; a refusal is not', async () => {
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

test('a batch the graph refuses is the call failing, not a call left claimed', async () => {
  let { g, r } = world([{
    ...echo,
    run: () => [{ entity: { eid: '$nope' }, person: { nosuch: 1 } }],
  }])
  await r.ensure()
  let answer = await r.call(called('example_echo', { value: 'x' }))
  assertEquals(answer.some((b) => b.exception || b.error), true)
  assertEquals((await g.read('.execution&*'))[0].execution, { state: 'failed' })
  assertEquals((await g.read('.result&*')).length, 1)
})

test('a tool that ANSWERS a fault has not failed', async () => {
  let { g, r } = world([{
    ...echo,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    // A listing of what broke: entities wearing the very words a failure
    // wears. The runner's own `execution` is what says whether the call
    // failed, so a host reads that and not the shape of the answer.
    run: (_, g) => g.read('.error&*'),
  }])
  await r.ensure()
  await g.apply([{ entity: { eid: 'b1' }, error: { code: 'broke' } }])
  let asked = called('example_echo')
  let landed = await r.call(asked)
  assertEquals(landed.some((b) => b.error), true)
  assertEquals(faulted(landed, asked.entity.eid), false)
})

test("a tool that reads calls answers them, and only its own record is the runner's", async () => {
  let { r } = world([{
    ...echo,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    // A transcript's calls and their results, the failed one among them.
    run: (_, g) => g.read('.call&*'),
  }, {
    ...echo,
    name: 'example_broke',
    run: () => {
      throw new Error('broke')
    },
  }])
  await r.ensure()
  let broke = called('example_broke')
  await r.call(broke)
  let asked = called('example_echo')
  let landed = await r.call(asked)
  let answer = answerOf(landed, asked.entity.eid)
  assertEquals(answer.map((b) => b.entity.eid), [broke.entity.eid])
  assertEquals((answer[0].execution as Comp).state, 'failed')
  assertEquals(faulted(landed, asked.entity.eid), false)
})

test('a reading tool answers entities and writes none of them', async () => {
  let { g, r } = world([{
    ...echo,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: (_, g) => g.read('.person&*'),
  }])
  await r.ensure()
  await g.apply([{ entity: { eid: 'p1' }, person: {} }])
  let before = (await g.read('.person&*'))[0]
  let answer = await r.call(called('example_echo'))
  assertEquals(answer.find((b) => b.person)!.entity.eid, 'p1')
  // The row it found is the row it was: a read does not touch what it read.
  assertEquals((await g.read('.person&*'))[0], before)
})

test('an answer too long to send whole is refused, not crashed on', async () => {
  let vocab = words()
  let g = graph({ vocab, storage: ram(vocab) })
  let many: Tool = {
    ...echo,
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    run: () =>
      Array.from({ length: 20 }, (_, i) => ({
        entity: { eid: `e${i}` },
        content: { body: 'x'.repeat(40) },
      })),
  }
  let r = runner(g, { tools: [many], most: 300, report: () => {} })
  await r.ensure()
  let answer = await r.call(called('example_echo'))
  let error = answer.find((b) => b.error)!
  assertEquals((error.error as Comp).code, 'too_large')
  assertEquals(body(error).includes('\n'), false)
  assertEquals(answer.some((b) => b.entity.eid == 'e0'), false)
  assertEquals((await g.read('.execution&*'))[0].execution, { state: 'failed' })
})

test('an answer is worded whole within its budget, and counted past it', () => {
  let answer: Bundle[] = [
    { entity: { eid: 'a' }, doc: { title: 'one\ntwo' } },
    { entity: { eid: 'b' } },
  ]
  assertEquals(worded(answer), JSON.stringify(answer, null, 2))
  assertEquals(worded([]), '[]')
  let cut = worded(answer, 20)
  assertEquals(
    cut.startsWith(JSON.stringify(answer, null, 2).slice(0, 22)),
    true,
  )
  assertEquals(
    cut.endsWith('2 of 2 not said: an answer is worded in 20 characters'),
    true,
  )
})

test('a search answer says its marked hit as text', () => {
  let found: Bundle[] = [{
    entity: { eid: 'book-1' },
    hit: {
      kind: 'book',
      title: 'The Hobbit',
      snippet: 'A \x01burglar\x02\nleaves home',
      source: 'text',
    },
  }]
  assertEquals(
    worded(found),
    'book-1 The Hobbit · book — A *burglar* leaves home',
  )
})

test('a refused argument is an error code, not an exception', async () => {
  let { r } = world()
  await r.ensure()
  let answer = await r.call(called('example_echo'))
  assertEquals((answer.find((b) => b.error)!.error as Comp).code, 'arguments')
})

// A tool whose argument names a person, and whose answer says which eid it
// was handed. `readOnly` makes it a read of the same shape.
let mark = (readOnly = false): Tool => ({
  noun: 'person',
  verb: 'mark',
  description: 'Mark a person',
  readOnly,
  inputSchema: {
    type: 'object',
    properties: { who: { type: 'string', ref: 'person' } },
  },
  run: (call) => [{
    entity: { eid: '$said' },
    content: { body: String(argsOf(call).who) },
    output: { source: call.entity.eid },
  }],
})

// A graph where `Ada` is a name for p1 — and only when a person is meant.
let named = (tools: Tool[]) => {
  let vocab = words()
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [{
      name: 'names',
      address: (_, ids, kind) =>
        new Map(
          ids.filter((id) => id == 'Ada' && kind == 'person').map(
            (id) => [id, 'p1'],
          ),
        ),
    }],
  })
  return { g, r: runner(g, { tools, report: () => {} }) }
}

test('a reference arrives as the eid it names, of the kind it declares', async () => {
  let { g, r } = named([mark()])
  await r.ensure()
  await g.apply([{ entity: { eid: 'p1' }, person: {} }])
  let answer = await r.call(called('person_mark', { who: 'Ada' }))
  assertEquals(body(answer.find((b) => b.output)), 'p1')
})

test('a write naming nothing of its kind is refused, and mints nothing', async () => {
  let { g, r } = named([mark()])
  await r.ensure()
  await g.apply([{ entity: { eid: 'c1' }, content: { body: 'not a person' } }])
  for (let who of ['ghost', 'c1']) {
    let answer = await r.call(called('person_mark', { who }))
    assertEquals((answer.find((b) => b.error)!.error as Comp).code, 'arguments')
    assertEquals(
      body(answer.find((b) => b.error)),
      `CallError: who: ${who} names no person`,
    )
  }
  assertEquals(await g.get(['ghost']), [])
})

test('a read is answered about whatever its reference names', async () => {
  let { r } = named([mark(true)])
  await r.ensure()
  let answer = await r.call(called('person_mark', { who: 'ghost' }))
  assertEquals(body(answer.find((b) => b.output)), 'ghost')
})

test("a tool writes in the CALLER's name, never the runner's", async () => {
  let { g, r } = world()
  await r.ensure()
  await g.apply([{ entity: { eid: 'p1' }, person: {} }])
  await r.call(called('example_echo', { value: 'mine' }, 'p1'))
  let [said] = await g.read('.output&*')
  assertEquals((said.created as Comp).by, 'p1')
})

test('two runners over one graph are one claimant and one answer', async () => {
  let { g, r, fx } = watched()
  await r.ensure()
  // A door's runner beside a daemon's. The effect runs the call the moment it
  // is written; the runner that wrote it still reads back what was landed,
  // and the tool ran once between them.
  let other = runner(g, { tools: [echo] })
  for (let rule of other.rules) fx.on(rule.plan, (e) => other.due(e.entity.eid))
  let answer = await other.call(called('example_echo', { value: 'both' }))
  assertEquals(body(answer.find((b) => b.output)), 'both 2')
  assertEquals((await g.read('.result&*')).length, 1)
})

test('a call somebody else wrote is run because an effect matched it', async () => {
  let { g, r } = watched()
  await r.ensure()
  // Nobody awaits this: it is a plain write, by a plain writer.
  await g.apply([{
    entity: { eid: 'c9' },
    call: { to: toolEid('example_echo'), args: { value: 'elsewhere' } },
  }])
  assertEquals(body((await g.read('.result&*'))[0]), 'elsewhere 2')
  assertEquals((await g.read('.execution&*'))[0].execution, { state: 'done' })
})

test('a call its caller runs owes the pool nothing; one nobody runs does', async () => {
  let vocab = words()
  let fx = effects(vocab, { report: () => {} })
  let g = graph({ vocab, storage: ram(vocab), plugins: [fx] })
  let r = runner(g, { tools: [echo], report: () => {} })
  let owed: string[] = []
  for (let rule of r.rules) {
    fx.on(rule.plan, (e) => void owed.push(e.entity.eid))
  }
  await r.ensure()
  await r.call(called('example_echo', { value: 'mine' }))
  await g.apply([{
    entity: { eid: 'c9' },
    call: { to: toolEid('example_echo'), args: { value: 'theirs' } },
  }])
  assertEquals(owed, ['c9'])
})

test('a call for a tool this runner has no word for is left alone', async () => {
  let { g, r } = watched()
  await r.ensure()
  await g.apply([{
    entity: { eid: 'c2' },
    call: { to: toolEid('somebody_else'), args: {} },
  }])
  assertEquals((await r.drive()).length, 0)
  assertEquals((await g.read('.result&*')).length, 0)
  assertEquals((await g.read('.execution&*')).length, 0)
})

test('a call this runner does not take is left alone', async () => {
  let vocab = words()
  let g = graph({ vocab, storage: ram(vocab) })
  let r = runner(g, {
    tools: [echo],
    takes: (call) => call.entity.eid != 'theirs',
    report: () => {},
  })
  await r.ensure()
  let asked = (eid: string) => ({
    entity: { eid },
    call: { to: toolEid('example_echo'), args: { value: eid } },
  })
  await g.apply([asked('theirs'), asked('mine')])
  await r.drive()
  assertEquals(
    (await g.read('.execution&*')).map((b) => b.entity.eid),
    ['mine'],
  )
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

test('a call waiting on a wake that has not fired is not this tick', async () => {
  let { g, r } = watched([echo], clock)
  await r.ensure()
  // Written, and sleeping: the ready rule says `!wake` and this one wears it.
  await g.apply([{
    entity: { eid: 'later' },
    call: { to: toolEid('example_echo'), args: { value: 'soon' } },
    wake: { at: '2030-01-01T00:00:00.000Z' },
  }])
  assertEquals((await g.read('.result&*')).length, 0)
  // Fired — and the second registration, which is the whole of the scheduled
  // case, selects it.
  await g.apply([{
    entity: { eid: 'later' },
    fired: { at: '2030-01-01T00:00:00.000Z' },
  }])
  assertEquals(body((await g.read('.result&*'))[0]), 'soon 2')
})

test('a recurring call is a standing ask: one invocation per firing', async () => {
  let { g, r } = watched([echo], clock)
  await r.ensure()
  // The schedule: a call that wears a recurrence. It is never answered
  // itself — each firing writes its own call, so the row keeps asking.
  await g.apply([{
    entity: { eid: 'daily' },
    call: { to: toolEid('example_echo'), args: { value: 'tick' } },
    wake: { at: '2030-01-01T00:00:00.000Z', every: '1d' },
  }])
  assertEquals((await g.read('.result&*')).length, 0)
  for (let at of ['2030-01-01T00:00:00.000Z', '2030-01-02T00:00:00.000Z']) {
    await g.apply([{ entity: { eid: 'daily' }, fired: { at } }])
  }
  // Two firings, two calls of their own, two results — and the schedule has
  // neither a result nor a claim on it.
  let made = await g.read('.call.source=daily&*')
  assertEquals(made.length, 2)
  assertEquals((await g.read('.result&*')).length, 2)
  assertEquals((await g.read('.result.call=daily&*')).length, 0)
  assertEquals((await g.read('.execution.state=done&*')).length, 2)
  // The same firing twice is the same call: an instant names one invocation.
  await g.apply([{
    entity: { eid: 'daily' },
    fired: { at: '2030-01-02T00:00:00.000Z' },
  }])
  assertEquals((await g.read('.call.source=daily&*')).length, 2)
})
