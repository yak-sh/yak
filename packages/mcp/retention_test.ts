/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { toolCheck } from '@yaks/vocab/tools'
import { CallError } from '@yaks/tools'
import { valued } from '@yaks/tools/value'
import { WORDS } from '@yaks/tools/result'
import { connect, text } from './testing.ts'

test('MCP returns the whole answer and its accompanying prose without an opt-in', async () => {
  let body = 'x'.repeat(WORDS + 1)
  let client = await connect({
    core: false,
    tools: [{
      name: 'large',
      description: 'Read a large result',
      readOnly: true,
      outputSchema: { type: 'object' },
      run: (call) => [{ ...valued(call, { body }), content: { body } }],
    }],
  })
  try {
    let out = await client.callTool({ name: 'large' })
    equal((out.structuredContent as { body: string }).body.length, body.length)
    equal(
      String((out.structuredContent as { said: string }).said).includes(body),
      true,
    )
    equal(text(out).includes(body), true)
  } finally {
    await client.close()
  }
})

test('MCP preserves an ordinary answer and requested text rendering', async () => {
  let reports: unknown[] = []
  let client = await connect({
    core: false,
    tools: [{
      name: 'count',
      description: 'Count books',
      readOnly: true,
      outputSchema: {
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
        additionalProperties: false,
      },
      run: (call) => [valued(call, { count: 2 })],
    }],
    text: () => Promise.resolve('Two books.'),
    roster: () => ({ line: 'Tools changed.' }),
    report: (err) => void reports.push(err),
  })
  try {
    let { tools } = await client.listTools()
    let check = toolCheck(tools[0].outputSchema!)
    let out = await client.callTool({ name: 'count' })
    equal(text(out), 'Two books.')
    equal(out.structuredContent, { count: 2, said: 'Tools changed.' })
    equal(check(out.structuredContent), [])
    equal(check({ count: 'two' }).length > 0, true)
    equal(check({ kept: 1 }).length > 0, true)
    equal(reports, [])
  } finally {
    await client.close()
  }
})

test('a refusal answers as an MCP tool error', async () => {
  let reports: unknown[] = []
  let client = await connect({
    core: false,
    tools: [{
      name: 'refuse',
      description: 'Refuse a call',
      readOnly: true,
      run: () => {
        throw new CallError('closed', 'The shelf is closed.')
      },
    }],
    report: (err) => void reports.push(err),
  })
  try {
    await client.listTools()
    let out = await client.callTool({ name: 'refuse' })
    equal(out.isError, true)
    equal(text(out).includes('The shelf is closed.'), true)
    equal(reports, [])
  } finally {
    await client.close()
  }
})
