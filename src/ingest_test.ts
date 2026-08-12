// The Event → EntrySpec mappers: each provider dialect's line becomes the
// existing entry vocabulary, tool calls correlate to their results, and no
// credential rides through. Pure and fast — no db, no file, no subprocess.
import { assert, assertEquals } from '@std/assert'
import {
  claudeEntries,
  codexEntries,
  ingestEntries,
  type IngestState,
  scrub,
} from './ingest.ts'

let fresh = (): IngestState => ({ calls: new Map() })

Deno.test('claude: text and thinking become say + reasoning entries', () => {
  let s = fresh()
  let text = claudeEntries(
    { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
    s,
  )
  assertEquals(text.specs, [{
    message: { role: 'agent' },
    content: { body: 'OK' },
  }])

  let think = claudeEntries(
    {
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'hmm' }] },
    },
    s,
  )
  assertEquals(think.specs, [{ reasoning: {}, content: { body: 'hmm' } }])

  // an empty thinking block is a bare reasoning entry (renders no row)
  let blank = claudeEntries(
    {
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: '' }] },
    },
    s,
  )
  assertEquals(blank.specs, [{ reasoning: {} }])
})

Deno.test('claude: a user turn is a user message', () => {
  let s = fresh()
  let b = claudeEntries(
    { type: 'user', message: { content: 'go on' } },
    s,
  )
  assertEquals(b.specs, [{
    message: { role: 'user' },
    content: { body: 'go on' },
  }])
})

Deno.test('claude: several content blocks become several entries in one batch', () => {
  let s = fresh()
  let b = claudeEntries(
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ],
      },
    },
    s,
  )
  assertEquals(b.specs.length, 2)
  assertEquals(b.ids.length, 2)
  assertEquals(b.specs[1].content.body, 'two')
})

Deno.test('claude: a Bash tool_use is a shell call, correlated to its later result', () => {
  let s = fresh()
  let call = claudeEntries(
    {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Bash',
          input: { command: 'ls -la', description: 'list' },
        }],
      },
    },
    s,
  )
  assertEquals(call.specs, [{
    call: { key: 'toolu_1' },
    bash: { command: 'ls -la' },
  }])
  // the caller commits the correlation after append; do it as drain would
  assertEquals(call.calls.length, 1)
  let [key, id] = call.calls[0]
  assertEquals(key, 'toolu_1')
  assertEquals(id, call.ids[0])
  s.calls.set(key, id)

  let result = claudeEntries(
    {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'total 0',
          is_error: false,
        }],
      },
    },
    s,
  )
  assertEquals(result.specs, [{
    result: { call: id },
    content: { body: 'total 0' },
    exit: { code: 0 },
  }])
})

Deno.test('claude: an errored tool_result carries a nonzero code, never error{}', () => {
  let s = fresh()
  let b = claudeEntries(
    {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'x',
          content: 'boom',
          is_error: true,
        }],
      },
    },
    s,
  )
  // no call was seen, so the result is bare (still renders as a ↳ row)
  assertEquals(b.specs[0].result, {})
  assertEquals(b.specs[0].exit, { code: 1 })
  assert(!('error' in b.specs[0]))
})

Deno.test('claude: a non-Bash tool_use keeps its real name and a detail', () => {
  let s = fresh()
  let b = claudeEntries(
    {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 't2',
          name: 'Read',
          input: { file_path: '/etc/hosts' },
        }],
      },
    },
    s,
  )
  assertEquals(b.specs, [{
    call: { key: 't2' },
    tool: { name: 'Read', detail: '/etc/hosts' },
  }])
})

Deno.test('codex: an agent_message and reasoning map to say and reason', () => {
  let s = fresh()
  assertEquals(
    codexEntries(
      {
        type: 'item.completed',
        item: { id: 'i0', type: 'agent_message', text: 'hi' },
      },
      s,
    ).specs,
    [{ message: { role: 'agent' }, content: { body: 'hi' } }],
  )
  assertEquals(
    codexEntries(
      {
        type: 'item.completed',
        item: { id: 'i1', type: 'reasoning', text: 'why' },
      },
      s,
    ).specs,
    [{ reasoning: {}, content: { body: 'why' } }],
  )
})

Deno.test('codex: a command_execution is a call and its result in one batch', () => {
  let s = fresh()
  let b = codexEntries(
    {
      type: 'item.completed',
      item: {
        id: 'i2',
        type: 'command_execution',
        command: 'deno task check',
        aggregated_output: 'ok',
        exit_code: 0,
        status: 'completed',
      },
    },
    s,
  )
  assertEquals(b.specs.length, 2)
  assertEquals(b.specs[0], {
    call: { key: 'i2' },
    bash: { command: 'deno task check' },
  })
  // the result names the call entry's eid — correlation without a second line
  assertEquals(b.specs[1], {
    result: { call: b.ids[0] },
    content: { body: 'ok' },
    exit: { code: 0 },
  })
})

Deno.test('codex: a nonzero exit is a normal result, not an error', () => {
  let s = fresh()
  let b = codexEntries(
    {
      type: 'item.completed',
      item: {
        id: 'i3',
        type: 'command_execution',
        command: 'task --help',
        aggregated_output: 'not found',
        exit_code: 127,
        status: 'failed',
      },
    },
    s,
  )
  assertEquals(b.specs[1].exit, { code: 127 })
  assert(!('error' in b.specs[1]))
})

Deno.test('codex: a file_change is a patch call with its paths', () => {
  let s = fresh()
  let b = codexEntries(
    {
      type: 'item.completed',
      item: {
        id: 'i4',
        type: 'file_change',
        changes: [{ path: 'src/a.ts', kind: 'update' }, {
          path: 'src/b.ts',
          kind: 'add',
        }],
        status: 'completed',
      },
    },
    s,
  )
  assertEquals(b.specs[0].call, { key: 'i4' })
  assertEquals(b.specs[0].patch.path, 'src/a.ts, src/b.ts')
  assertEquals(b.specs[1], { result: { call: b.ids[0] }, exit: { code: 0 } })
})

Deno.test('codex: a failed mcp tool call carries its message on stderr, not error{}', () => {
  let s = fresh()
  let b = codexEntries(
    {
      type: 'item.completed',
      item: {
        id: 'i5',
        type: 'mcp_tool_call',
        server: 'tasks',
        tool: 'task_comment',
        arguments: { id: 'T-1' },
        error: { message: 'cancelled' },
        status: 'failed',
      },
    },
    s,
  )
  assertEquals(b.specs[0].tool, {
    name: 'tasks.task_comment',
    detail: '{"id":"T-1"}',
  })
  assertEquals(b.specs[1].stderr, { text: 'cancelled' })
  assert(!('error' in b.specs[1]))
})

Deno.test('codex: usage and lifecycle events produce no entries', () => {
  let s = fresh()
  assertEquals(codexEntries({ type: 'turn.completed', usage: {} }, s).specs, [])
  assertEquals(
    codexEntries({ type: 'turn.failed', error: { message: 'x' } }, s).specs,
    [],
  )
  assertEquals(
    codexEntries({ type: 'thread.started', thread_id: 'x' }, s).specs,
    [],
  )
  assertEquals(
    codexEntries({ type: 'item.started', item: { type: 'x' } }, s).specs,
    [],
  )
})

Deno.test('scrub: credential shapes are redacted, ordinary text survives', () => {
  assertEquals(
    scrub('run with sk-ant-abcdefgh12345 please'),
    'run with [redacted] please',
  )
  assertEquals(
    scrub('Authorization: Bearer abcdef.ghijkl'),
    'Authorization: [redacted]',
  )
  assertEquals(
    scrub('api_key=SUPERSECRETVALUE next'),
    'api_key=[redacted] next',
  )
  assertEquals(scrub('ls -la /home/user'), 'ls -la /home/user') // no secret, untouched
})

Deno.test('ingestEntries dispatches by dialect and defaults to nothing', () => {
  let s = fresh()
  assertEquals(
    ingestEntries(
      'claude',
      { type: 'assistant', message: { content: 'hi' } },
      s,
    ).specs
      .length,
    1,
  )
  assertEquals(
    ingestEntries('codex', {
      type: 'item.completed',
      item: { id: 'a', type: 'agent_message', text: 'hi' },
    }, s).specs.length,
    1,
  )
  assertEquals(ingestEntries(undefined, { type: 'whatever' }, s).specs, [])
})
