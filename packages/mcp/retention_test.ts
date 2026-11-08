/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { toolCheck } from '@yaks/vocab/tools'
import { CallError } from '@yaks/tools'
import { valued } from '@yaks/tools/value'
import { WORDS } from '@yaks/tools/result'
import type { Bundle, Tool } from '@yaks/graph'
import { connect, text } from './testing.ts'

let keptSchema = {
  type: 'object',
  properties: { kept: { type: 'string' } },
  required: ['kept'],
  additionalProperties: false,
}

let summary = () => ({
  content: [{ type: 'text' as const, text: 'The whole result is kept as r1.' }],
  structuredContent: { kept: 'r1' },
})

test('MCP retention receives the whole answer before rendering and preserves its summary', async () => {
  let body = 'x'.repeat(WORDS + 1)
  let seen: { answer: Bundle[]; tool: Tool; call: Bundle } | undefined
  let reports: unknown[] = []
  let client = await connect({
    core: false,
    tools: [{
      name: 'large',
      description: 'Read a large result',
      readOnly: true,
      run: (call) => [valued(call, { body })],
    }],
    retain: {
      schema: keptSchema,
      result: (answer, tool, call) => {
        seen = { answer, tool, call }
        return Promise.resolve(summary())
      },
    },
    text: () =>
      Promise.reject(new Error('retained summaries are already text')),
    roster: () => ({ line: 'Tools changed.' }),
    report: (err) => void reports.push(err),
  })
  try {
    await client.listTools()
    let out = await client.callTool({ name: 'large' })
    equal(
      (seen?.answer[0].output as { value: { body: string } }).value.body,
      body,
    )
    equal(seen?.tool.name, 'large')
    equal(typeof seen?.call.entity.eid, 'string')
    equal(text(out), 'The whole result is kept as r1.')
    equal(out.structuredContent, { kept: 'r1', said: 'Tools changed.' })
    equal(reports, [])
  } finally {
    await client.close()
  }
})

test('MCP retention can leave an ordinary answer and its text unchanged', async () => {
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
    retain: { schema: keptSchema, result: () => Promise.resolve(undefined) },
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
    equal(check({ kept: 'r1', said: 'Tools changed.' }), [])
    equal(check({ count: 'two' }).length > 0, true)
    equal(check({ kept: 1 }).length > 0, true)
    equal(reports, [])
  } finally {
    await client.close()
  }
})

test('a retained refusal still answers as an MCP tool error', async () => {
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
    retain: { schema: keptSchema, result: () => Promise.resolve(summary()) },
    report: (err) => void reports.push(err),
  })
  try {
    await client.listTools()
    let out = await client.callTool({ name: 'refuse' })
    equal(out.isError, true)
    equal(out.structuredContent, { kept: 'r1' })
    equal(reports, [])
  } finally {
    await client.close()
  }
})
