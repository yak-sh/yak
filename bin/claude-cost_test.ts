// Billing and deduplication are checked without reading private transcripts.
import { equal, test, throws } from '@yaks/testing'
import { bill, options, prefer, summary, taskIds } from './claude-cost.ts'

let message = (usage: Record<string, unknown>) => ({
  model: 'claude-opus-5-5',
  usage,
})
let record = (own: boolean, output: number, path = '/original.jsonl') => ({
  own,
  path,
  message: { usage: { output_tokens: output } },
})

test('billing separates mixed cache TTLs and treats thinking as output subset', () => {
  let b = bill(message({
    input_tokens: 100,
    cache_creation_input_tokens: 1000,
    cache_creation: {
      ephemeral_5m_input_tokens: 400,
      ephemeral_1h_input_tokens: 600,
    },
    cache_read_input_tokens: 2000,
    output_tokens: 500,
    output_tokens_details: { thinking_tokens: 300 },
  }))
  equal(b.context, 3100)
  equal(b.tokens.output, 500)
  equal(b.costs.thinking, .006)
  equal(b.costs.output, .004)
  equal(Math.round(b.cost * 1e6), 17600)
})

test('billing infers remaining short TTL writes and rejects unknown models', () => {
  let b = bill(message({
    cache_creation_input_tokens: 1000,
    cache_creation: { ephemeral_1h_input_tokens: 600 },
  }))
  equal(b.tokens.write5m, 400)
  equal(b.tokens.write1h, 600)
  throws(() => bill({ model: 'claude-opus-future', usage: {} }))
})

test('dedup prefers the originating request over copied history and cumulative final usage', () => {
  equal(prefer(record(false, 600), record(true, 400)), true)
  equal(prefer(record(true, 400), record(false, 600)), false)
  equal(prefer(record(true, 400), record(true, 600)), true)
  equal(prefer(record(true, 600), record(true, 400)), false)
  equal(prefer(record(true, 600), record(true, 600, '/mirror.output')), false)
  equal(prefer(record(true, 400), record(true, 600, '/mirror.output')), true)
})

let summaryReport = {
  since: 'start',
  until: 'end',
  totalCost: 1000,
  uniqueMessages: 100,
  sessions: Array.from(
    { length: 1000 },
    () => ({ command: 'unread command' }),
  ),
  costs: {
    read: 500,
    write5m: 300,
    thinking: 100,
    output: 50,
    write1h: 30,
    input: 20,
  },
  taskCosts: Object.fromEntries(
    Array.from({ length: 1000 }, (_, i) => [`T-${i}`, i]),
  ),
  context: { median: 100, p90: 200, max: 300 },
  operator: { own: 100, cost: 900 },
}

test('summary stays bounded with many sessions and tasks while showing the largest costs', () => {
  let output = summary(summaryReport)
  equal(output.split('\n').length <= 20, true)
  equal(
    output.includes('100 requests; 1000 sessions; $10.00 per request'),
    true,
  )
  equal(output.includes('T-999: $999.00'), true)
  equal(output.includes('T-0:'), false)
  equal(output.includes('unread command'), false)
})

test('json flag leaves date and root positionals intact in every position', () => {
  for (
    let args of [['--json', 'start', 'end', '/root'], [
      'start',
      '--json',
      'end',
      '/root',
    ], ['start', 'end', '/root', '--json']]
  ) {
    equal(options(args), { json: true, positionals: ['start', 'end', '/root'] })
  }
})

test('assignments include CLI and MCP work without incidental references', () => {
  let call = (name: string, input: Record<string, unknown>) => ({
    type: 'tool_use',
    name,
    input,
  })
  equal(
    taskIds({
      type: 'assistant',
      message: {
        content: [
          call('Bash', { command: 'yak task claim T-1; yak task done T-2' }),
          call('mcp__tasks__claim_take', { target: 'T-3' }),
          call('mcp__tasks__task_update', { task: 'T-4', status: 'done' }),
          call('mcp__tasks__task_update', { task: 'T-5', body: 'See T-6' }),
          call('mcp__tasks__task_new', { body: 'Fix T-7' }),
          { type: 'text', text: 'T-8 is related' },
        ],
      },
    }),
    ['T-1', 'T-2', 'T-3', 'T-4'],
  )
  equal(
    taskIds({
      type: 'user',
      message: {
        content: [
          { type: 'text', text: 'Work on T-9 and T-10. Related: T-11.' },
          { type: 'tool_result', content: 'Work T-12.' },
        ],
      },
    }),
    ['T-9', 'T-10'],
  )
})
