import { assertEquals, assertRejects } from '@std/assert'
import { graph, type Tool, type ToolCtx } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { callDoc, executeCall, graphInvocation, UnfinishedCall } from './mod.ts'

const setup = async (args = '{}') => {
  const vocab = loadVocab([callDoc, {
    $defs: { tool: { properties: { name: { type: 'string' } } } },
  }])
  const g = graph({ vocab, storage: ram(vocab) })
  await g.apply([
    { entity: { eid: 'tool' }, tool: { name: 'echo' } },
    { entity: { eid: 'call' }, call: { to: 'tool', args } },
  ])
  return g
}

Deno.test('recorded graph tools need no session and validate the same JSON Schema', async () => {
  const g = await setup('{"value":"hello"}')
  const ctx: ToolCtx = {
    graph: g,
    actor: null,
    apply: (b) => g.apply(b),
    read: (q) => g.read(q),
  }
  const tool: Tool = {
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
    run: (args) => ({ value: args.value, count: args.count }),
  }
  const outcomes = await executeCall(g, 'call', {
    resolve: () => graphInvocation(tool, ctx),
  })
  const result = outcomes.find((b) => b.result)!
  assertEquals(result.entry, undefined)
  assertEquals(JSON.parse(String((result.content as { body: string }).body)), {
    value: 'hello',
    count: 2,
  })
  assertEquals((await g.read('.execution'))[0].execution, {
    state: 'completed',
  })
})

Deno.test('concurrent observers share execution and replay returns the stored result', async () => {
  const g = await setup()
  let runs = 0
  let release!: () => void
  const wait = new Promise<void>((resolve) => release = resolve)
  const options = {
    resolve: () => ({
      run: async () => {
        runs++
        await wait
        return 'done'
      },
    }),
  }
  const a = executeCall(g, 'call', options)
  const b = executeCall(g, 'call', options)
  release()
  await Promise.all([a, b])
  await executeCall(g, 'call', options)
  assertEquals(runs, 1)
  assertEquals((await g.read('.result')).length, 1)
})

Deno.test('a durable started call is never implicitly replayed', async () => {
  const g = await setup()
  await g.apply([{ entity: { eid: 'call' }, execution: { state: 'started' } }])
  let ran = false
  await assertRejects(() =>
    executeCall(g, 'call', {
      resolve: () => ({
        run: () => {
          ran = true
        },
      }),
    }), UnfinishedCall)
  assertEquals(ran, false)
})

Deno.test('malformed arguments and unknown tools record errors and paired results', async () => {
  for (const args of ['{', '[]', 'null']) {
    const g = await setup(args)
    let ran = false
    await executeCall(g, 'call', {
      resolve: () => ({
        run: () => {
          ran = true
        },
      }),
    })
    assertEquals(ran, false)
    assertEquals((await g.read('.error'))[0].error, { code: 'arguments' })
    assertEquals((await g.read('.result')).length, 1)
  }
  const g = await setup()
  await executeCall(g, 'call', { resolve: () => undefined })
  assertEquals((await g.read('.error'))[0].error, { code: 'tool' })
})

Deno.test('programming faults retain exception and never rerun the tool', async () => {
  const g = await setup()
  let report: unknown
  const error = new Error('broken')
  await executeCall(g, 'call', {
    resolve: () => ({
      run: () => {
        throw error
      },
    }),
    report: (e) => report = e,
  })
  assertEquals(report, error)
  assertEquals((await g.read('.exception')).length, 1)
  assertEquals((await g.read('.result')).length, 1)
})

Deno.test('separate Graph instances cannot execute a claimed call twice', async () => {
  const first = await setup()
  const second = graph({ vocab: first.vocab, storage: first.storage })
  let started!: () => void, release!: () => void
  const began = new Promise<void>((resolve) => started = resolve)
  const wait = new Promise<void>((resolve) => release = resolve)
  let runs = 0
  const options = {
    resolve: () => ({
      run: async () => {
        runs++
        started()
        await wait
        return 'done'
      },
    }),
  }
  const running = executeCall(first, 'call', options)
  await began
  await assertRejects(
    () => executeCall(second, 'call', options),
    UnfinishedCall,
  )
  release()
  await running
  assertEquals(runs, 1)
})

Deno.test('schema refusal happens before the handler, with a recorded result', async () => {
  const g = await setup('{"value": false}')
  const ctx: ToolCtx = {
    graph: g,
    actor: null,
    apply: (b) => g.apply(b),
    read: (q) => g.read(q),
  }
  let ran = false
  const tool: Tool = {
    noun: 'example',
    verb: 'echo',
    description: 'Echo a string',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
    },
    run: () => {
      ran = true
    },
  }
  await executeCall(g, 'call', { resolve: () => graphInvocation(tool, ctx) })
  assertEquals(ran, false)
  assertEquals((await g.read('.error'))[0].error, { code: 'arguments' })
  assertEquals((await g.read('.result')).length, 1)
})
