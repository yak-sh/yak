import { assertEquals } from '@std/assert'
import { claude, codex, type Event } from './readers.ts'

let say = (content: unknown, more: Event = {}) => ({
  type: 'user',
  message: { content },
  ...more,
})
let reply = (...content: Event[]) => ({
  type: 'assistant',
  message: { content },
})
let entries = (read: typeof claude, e: Event) => read(e).entries

Deno.test('claude: who said it — a person, the harness, or the model', () => {
  let human = { origin: { kind: 'human' } }
  let cases: [Event, unknown][] = [
    [say('fix it', human), [{ content: { body: 'fix it' } }]],
    // A slash command is recorded as its wrapper; the person typed the command.
    [
      say(
        '<command-name>/model</command-name><command-args>opus</command-args>',
        human,
      ),
      [{ content: { body: '/model opus' } }],
    ],
    [
      say('<task-notification>done</task-notification>', {
        origin: { kind: 'task-notification' },
      }),
      [{
        content: { body: '<task-notification>done</task-notification>' },
        notice: {},
      }],
    ],
    // Typed while a turn ran: it reaches the model as an attachment.
    [
      {
        type: 'attachment',
        attachment: { type: 'queued_command', prompt: 'and this', ...human },
      },
      [{ content: { body: 'and this' } }],
    ],
    [
      reply({ type: 'text', text: 'done' }, {
        type: 'thinking',
        thinking: 'hmm',
      }),
      [
        { content: { body: 'done' }, output: {} },
        { content: { body: 'hmm' }, reasoning: {}, output: {} },
      ],
    ],
    // A subagent's side conversation is not this session's.
    [{ ...say('hi', human), isSidechain: true }, []],
    [{ type: 'attachment', attachment: { type: 'date' } }, []],
  ]
  for (let [e, want] of cases) assertEquals(entries(claude, e), want)
})

Deno.test('claude: a tool call and its result, a credential scrubbed from both', () => {
  let use = {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'Bash',
    input: { command: 'curl -H "Authorization: Bearer abc.def" x' },
  }
  assertEquals(entries(claude, reply(use)), [{
    call: {
      to: 'Bash',
      id: 'toolu_1',
      args: { command: 'curl -H "Authorization: [redacted]" x' },
    },
  }])
  let result = (is_error: boolean) =>
    say([{
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: [{ type: 'text', text: 'token=ghp_0123456789abcdef' }],
      is_error,
    }])
  assertEquals(entries(claude, result(false)), [{
    result: { call: 'toolu_1' },
    content: { body: 'token=[redacted]' },
    execution: { state: 'done' },
  }])
  assertEquals(
    entries(claude, result(true))[0].execution,
    { state: 'failed' },
  )
})

Deno.test('claude: a managed run opens with its id and ends with its cost', () => {
  assertEquals(
    claude({ type: 'system', subtype: 'init', session_id: 'abc' }).about,
    { session: { id: 'abc' } },
  )
  assertEquals(
    entries(claude, { type: 'result', usage: { input_tokens: 12 } }),
    [{ stop: {}, usage: { input_tokens: 12 } }],
  )
  // A refusal is an ending too — with the diagnosis it carried.
  assertEquals(
    entries(claude, {
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'over quota',
    }),
    [{
      error: { code: 'success' },
      content: { body: 'over quota' },
      output: {},
      stop: {},
    }],
  )
  assertEquals(claude(say('hi', { timestamp: 'T1' })).at, 'T1')
})

Deno.test('codex: what it said, what it ran, and the turn it closed', () => {
  let run = (status: string, exit_code: number | null) => ({
    id: 'item_1',
    type: 'command_execution',
    command: 'ls',
    aggregated_output: status == 'in_progress' ? '' : 'a\nb',
    exit_code,
    status,
  })
  let cases: [Event, unknown][] = [
    [
      { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } },
      [{ content: { body: 'hi' }, output: {} }],
    ],
    [
      { type: 'item.started', item: run('in_progress', null) },
      [{
        call: {
          to: 'command_execution',
          id: 'item_1',
          args: { command: 'ls' },
        },
      }],
    ],
    [
      { type: 'item.completed', item: run('completed', 1) },
      [
        {
          call: {
            to: 'command_execution',
            id: 'item_1',
            args: { command: 'ls' },
          },
        },
        {
          result: { call: 'item_1' },
          content: { body: 'a\nb' },
          execution: { state: 'failed' },
        },
      ],
    ],
    [
      {
        type: 'item.started',
        item: {
          id: 'item_2',
          type: 'mcp_tool_call',
          server: 'yak',
          tool: 'task_new',
          arguments: { title: 't' },
          status: 'in_progress',
        },
      },
      [{
        call: { to: 'mcp__yak__task_new', id: 'item_2', args: { title: 't' } },
      }],
    ],
    [
      { type: 'turn.completed', usage: { cached_input_tokens: 7 } },
      [{ stop: {}, usage: { cached_tokens: 7 } }],
    ],
    [
      { type: 'turn.failed', error: { message: 'nope' } },
      [{
        error: { code: 'turn.failed' },
        content: { body: 'nope' },
        output: {},
        stop: {},
      }],
    ],
  ]
  for (let [e, want] of cases) assertEquals(entries(codex, e), want)
  assertEquals(
    codex({ type: 'thread.started', thread_id: 't1' }).about,
    { session: { id: 't1' } },
  )
})
