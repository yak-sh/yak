// The Event → EntrySpec mappers: each provider dialect's line becomes the
// existing entry vocabulary, tool calls correlate to their results, and no
// credential rides through. Pure and fast — no db, no file, no subprocess.
import { assert, assertEquals } from '@std/assert'
import {
  claudeEntries,
  codexEntries,
  codexTranscriptEntries,
  ingestEntries,
  type IngestState,
  ingestTranscript,
  scrub,
} from './ingest.ts'

let fresh = (): IngestState => ({ calls: new Map() })

// The harness marks what the human typed (origin.kind 'human'); what it
// injects as the user role — hook feedback, the compaction summary, command
// wrappers — is isMeta, promptSource 'system', or unmarked. Only the typed
// turn wears the `prompt` tag.
Deno.test('claude: a typed user turn wears prompt, an injected one does not', () => {
  let s = fresh()
  let typed = claudeEntries(
    {
      type: 'user',
      message: { content: 'fix the tui' },
      origin: { kind: 'human' },
      promptSource: 'typed',
    },
    s,
  )
  assertEquals(typed.specs, [{
    message: { role: 'user' },
    content: { body: 'fix the tui' },
    prompt: {},
  }])
  for (
    let e of [
      {
        type: 'user',
        message: { content: 'Stop hook feedback: x' },
        isMeta: true,
      },
      {
        type: 'user',
        message: { content: 'This session is being continued…' },
        isCompactSummary: true,
      },
      {
        type: 'user',
        message: { content: '<task-notification/>' },
        promptSource: 'system',
        origin: { kind: 'task-notification' },
      },
    ]
  ) {
    assertEquals(claudeEntries(e, s).specs[0].prompt, undefined)
  }
})

// A message typed mid-turn that the harness ABSORBED never becomes a `user`
// record; its queue removal is the only trace and mints the turn. A dequeued
// one does become a `user` record later, so its queue records mint nothing,
// and a harness payload absorbed the same way is not a turn.
Deno.test('claude: an absorbed queued message is a typed turn; other queue ops are not', () => {
  let s = fresh()
  let op = (operation: string, content?: string, reason?: string) => ({
    type: 'queue-operation',
    operation,
    ...(content == null ? {} : { content }),
    ...(reason ? { reason } : {}),
  })
  assertEquals(claudeEntries(op('enqueue', 'oh, i meant it'), s).specs, [])
  assertEquals(claudeEntries(op('dequeue'), s).specs, [])
  assertEquals(
    claudeEntries(op('remove', 'oh, i meant it', 'absorbed_mid_turn'), s)
      .specs,
    [{
      message: { role: 'user' },
      content: { body: 'oh, i meant it' },
      prompt: {},
    }],
  )
  assertEquals(
    claudeEntries(
      op(
        'remove',
        '<task-notification>\n<task-id>x</task-id>',
        'absorbed_mid_turn',
      ),
      s,
    ).specs,
    [],
  )
  assertEquals(
    claudeEntries(op('remove', 'x', 'delivered_to_agent'), s).specs,
    [],
  )
  // Were the harness to record the absorbed text as a user turn too, the
  // queue's copy already stands.
  assertEquals(
    claudeEntries(
      {
        type: 'user',
        message: { content: 'oh, i meant it' },
        origin: { kind: 'human' },
        promptSource: 'queued',
      },
      s,
    ).specs,
    [],
  )
})

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

// ---- native codex: the interactive rollout dialect (event_msg/response_item)

// One event_msg / response_item envelope, as the rollout writes it.
let msg = (payload: unknown) => ({ type: 'event_msg', payload })
let ri = (payload: unknown) => ({ type: 'response_item', payload })

Deno.test('native codex: user and agent narration ride event_msg', () => {
  let s = fresh()
  assertEquals(
    codexTranscriptEntries(msg({ type: 'user_message', message: 'hello' }), s)
      .specs,
    [{ message: { role: 'user' }, content: { body: 'hello' } }],
  )
  assertEquals(
    codexTranscriptEntries(
      msg({
        type: 'agent_message',
        message: 'hi there',
        phase: 'final_answer',
      }),
      s,
    ).specs,
    [{ message: { role: 'agent' }, content: { body: 'hi there' } }],
  )
})

Deno.test('native codex: response_item message (dup narration + instructions) is not a row', () => {
  let s = fresh()
  // the developer/system instructions and the assistant text repeat here —
  // skipped, so neither doubles the transcript nor leaks the instructions.
  assertEquals(
    codexTranscriptEntries(
      ri({
        type: 'message',
        role: 'developer',
        content: [{ text: 'SECRETS' }],
      }),
      s,
    ).specs,
    [],
  )
  assertEquals(
    codexTranscriptEntries(
      ri({ type: 'message', role: 'assistant', content: [{ text: 'hi' }] }),
      s,
    ).specs,
    [],
  )
})

Deno.test('native codex: reasoning summary becomes a reason entry, empty is bare', () => {
  let s = fresh()
  assertEquals(
    codexTranscriptEntries(
      ri({
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'thinking it through' }],
      }),
      s,
    ).specs,
    [{ reasoning: {}, content: { body: 'thinking it through' } }],
  )
  // codex often writes an empty summary — a bare reasoning entry (renders no row)
  assertEquals(
    codexTranscriptEntries(ri({ type: 'reasoning', summary: [] }), s).specs,
    [{ reasoning: {} }],
  )
})

Deno.test('native codex: a function_call shell correlates to its later output', () => {
  let s = fresh()
  let call = codexTranscriptEntries(
    ri({
      type: 'function_call',
      name: 'exec_command',
      call_id: 'call_9',
      arguments: JSON.stringify({ cmd: 'ls -la', workdir: '/x' }),
    }),
    s,
  )
  assertEquals(call.specs, [{
    call: { key: 'call_9' },
    bash: { command: 'ls -la' },
  }])
  // the output arrives on a LATER line and names the call across the map
  let [key, id] = call.calls[0]
  s.calls.set(key, id)
  let out = codexTranscriptEntries(
    ri({
      type: 'function_call_output',
      call_id: 'call_9',
      output: 'Process exited with code 0\nOutput:\ntotal 0',
    }),
    s,
  )
  assertEquals(out.specs[0].result, { call: id })
  assertEquals(out.specs[0].exit, { code: 0 })
  assert(!('error' in out.specs[0]))
})

Deno.test('native codex: a nonzero shell exit is a normal result, not error{}', () => {
  let s = fresh()
  let out = codexTranscriptEntries(
    ri({
      type: 'function_call_output',
      call_id: 'x',
      output: 'exited with code 127\nnot found',
    }),
    s,
  )
  assertEquals(out.specs[0].exit, { code: 127 })
  assert(!('error' in out.specs[0]))
})

Deno.test('native codex: a non-shell function_call keeps its name and a detail', () => {
  let s = fresh()
  let b = codexTranscriptEntries(
    ri({
      type: 'function_call',
      name: 'apply_patch',
      call_id: 'p1',
      arguments: JSON.stringify({ path: 'src/a.ts', patch: '@@' }),
    }),
    s,
  )
  assertEquals(b.specs[0].call, { key: 'p1' })
  assertEquals(b.specs[0].tool.name, 'apply_patch')
  assert(!('bash' in b.specs[0]))
})

Deno.test('native codex: lifecycle events produce no entries', () => {
  let s = fresh()
  for (
    let e of [
      msg({ type: 'task_started', turn_id: 't' }),
      msg({ type: 'task_complete', duration_ms: 10 }),
      msg({ type: 'token_count', info: {} }),
      { type: 'session_meta', payload: {} },
      { type: 'turn_context', payload: {} },
    ]
  ) assertEquals(codexTranscriptEntries(e, s).specs, [])
})

Deno.test('native codex: a credential in an output never reaches an entry', () => {
  let s = fresh()
  let out = codexTranscriptEntries(
    ri({
      type: 'function_call_output',
      call_id: 'z',
      output: 'exported api_key=SUPERSECRETVALUE ok',
    }),
    s,
  )
  let body = String(out.specs[0].content.body)
  assert(!body.includes('SUPERSECRETVALUE'), 'the api key leaked')
  assert(body.includes('[redacted]'))
})

Deno.test('ingestTranscript: claude shares its mapper, codex takes the rollout dialect', () => {
  let s = fresh()
  // claude persists the same shape it prints, so the managed mapper serves both
  assertEquals(
    ingestTranscript('claude', {
      type: 'assistant',
      message: { content: 'hi' },
    }, s).specs.length,
    1,
  )
  // codex's rollout is the DISTINCT dialect — a managed item.completed is not a
  // native line, and a native event_msg is not a managed one
  assertEquals(
    ingestTranscript('codex', {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'hi' },
    }, s).specs,
    [],
  )
  assertEquals(
    ingestTranscript('codex', msg({ type: 'agent_message', message: 'hi' }), s)
      .specs.length,
    1,
  )
  assertEquals(ingestTranscript(undefined, { type: 'x' }, s).specs, [])
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
