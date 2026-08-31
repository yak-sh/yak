// The adapter readers against REAL captured events — each fixture line is
// pasted from a live probe of the CLI it mimics (trimmed, same shape).
// If a vendor changes dialect, these say exactly which reader went deaf.
import { assertEquals, assertMatch, assertNotEquals } from '@std/assert'
import { adapters, ollama, providers, trouble } from './adapters.ts'

let { claude, codex } = adapters

Deno.test('claude: init names the session and the serving model', () => {
  let e = {
    type: 'system',
    subtype: 'init',
    cwd: '/tmp/x',
    session_id: 'b620ba4a-4a1d-44a1-aad0-2b31b3d01499',
    model: 'claude-haiku-4-5-20251001',
    permissionMode: 'bypassPermissions',
  }
  assertEquals(claude.init(e), {
    status: 'running',
    provider_session_id: 'b620ba4a-4a1d-44a1-aad0-2b31b3d01499',
    serving_model: 'claude-haiku-4-5-20251001',
  })
  assertEquals(claude.init({ type: 'system', subtype: 'hook_started' }), null)
  assertEquals(claude.terminal(e), null)
})

Deno.test('claude: the result event is the last word', () => {
  let e = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2065,
    result: 'OK',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 38 },
  }
  assertEquals(claude.terminal(e), {
    final_text: 'OK',
    usage_json: '{"input_tokens":10,"output_tokens":38}',
  })
  // an error result still ends the run — and says so
  let bad = claude.terminal({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: null,
  })
  assertEquals(bad?.error, 'result: error_during_execution')

  // API refusals can paradoxically carry subtype `success`; result is the
  // provider's useful diagnosis and therefore wins over that subtype.
  let refused = claude.terminal({
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: "You've hit your weekly limit",
  })
  assertEquals(refused?.error, "You've hit your weekly limit")
})

Deno.test('claude: known MCP stdout contamination is adapter-owned noise', () => {
  let warning =
    'Client.listTools() called but server does not advertise tools capability - returning empty list'
  assertEquals(claude.ignoreLine?.(warning), true)
  assertEquals(claude.ignoreLine?.('not json'), false)
})

Deno.test('claude: interactive assistant events state model and effort', () => {
  assertEquals(
    claude.observe?.({
      type: 'assistant',
      effort: 'high',
      message: { model: 'claude-sonnet-5' },
    }),
    {
      serving_model: 'claude-sonnet-5',
      effort: 'high',
    },
  )
  assertEquals(claude.observe?.({ type: 'user' }), null)
})

Deno.test('codex: thread.started is the init, sans model', () => {
  assertEquals(
    codex.init({
      type: 'thread.started',
      thread_id: '019f6f3e-f562-7263-9364-5d6d2fe419d6',
    }),
    {
      status: 'running',
      provider_session_id: '019f6f3e-f562-7263-9364-5d6d2fe419d6',
    },
  )
})

Deno.test('codex: each agent_message overwrites final_text; usage closes', () => {
  let msg = codex.init({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: 'OK' },
  })
  assertEquals(msg, { final_text: 'OK' })
  // other item kinds are just log
  assertEquals(
    codex.init({
      type: 'item.completed',
      item: { id: 'item_1', type: 'command_execution', text: 'ls' },
    }),
    null,
  )
  assertEquals(
    codex.terminal({
      type: 'turn.completed',
      usage: { input_tokens: 13966, output_tokens: 5 },
    }),
    { usage_json: '{"input_tokens":13966,"output_tokens":5}' },
  )
  assertEquals(
    codex.terminal({ type: 'turn.failed', error: { message: 'boom' } })
      ?.error,
    'boom',
  )
})

Deno.test('providers: every adapter but fake, allowlists only — no argv', () => {
  let ps = providers()
  assertEquals(
    ps.map((p) => p.name),
    [...Object.keys(adapters).filter((n) => n != 'fake'), 'ollama'],
  )
  // Every non-fallback provider projects the four allowlist fields; the CLI
  // fallback adds only its `fallback` marker — never argv, never a `ready`
  // (unstamped table).
  for (let p of ps) {
    assertEquals(
      Object.keys(p),
      p.name == 'codex-cli'
        ? ['name', 'models', 'efforts', 'labels', 'fallback']
        : ['name', 'models', 'efforts', 'labels'],
    )
  }
  // the browser offers exactly what a start request is checked against
  assertEquals(
    ps.find((p) => p.name == 'claude')?.models,
    adapters.claude.models,
  )
  // every friendly-named offer fronts an allowlisted model
  for (let p of ps) {
    for (let m of Object.keys(p.labels)) {
      assertEquals(p.models.includes(m), true)
    }
  }
  assertEquals(ps.find((p) => p.name == 'claude')?.efforts, [])
  assertEquals(
    ps.find((p) => p.name == 'codex')?.efforts,
    adapters.codex.efforts,
  )
  // The fallback carries the models (a valid, directly-requestable transport)
  // but NO menu of its own — the same models are already offered once through
  // graph-native codex, so a picker never shows them twice.
  let fallback = ps.find((p) => p.name == 'codex-cli')!
  assertEquals(fallback.models, adapters.codex.models)
  assertEquals(fallback.labels, {})
  assertEquals(fallback.fallback, true)
  assertEquals('argv' in fallback, false)
})

Deno.test('providers: a readiness probe stamps ready per provider', () => {
  let ps = providers((name) => name != 'codex')
  assertEquals(ps.find((p) => p.name == 'codex')?.ready, false)
  assertEquals(ps.find((p) => p.name == 'codex-cli')?.ready, true)
  assertEquals(ps.find((p) => p.name == 'claude')?.ready, true)
})

Deno.test('claude: opus-5 and the bare opus alias are barred; 4-8 is the default', () => {
  // A non-opus line rides its alias (latest is wanted); opus does not.
  assertEquals(trouble({ provider: 'claude', model: 'sonnet' }), null)
  assertEquals(trouble({ provider: 'claude', model: 'claude-opus-4-8' }), null)
  // The 1M-context variant is the same pin, accepted alongside the base.
  assertEquals(
    trouble({ provider: 'claude', model: 'claude-opus-4-8[1m]' }),
    null,
  )
  // The ban is a rejection, never a silent downgrade — both spellings that
  // reach claude-opus-5 are refused: the pinned id and the alias that
  // resolves to it.
  assertNotEquals(trouble({ provider: 'claude', model: 'claude-opus-5' }), null)
  assertNotEquals(trouble({ provider: 'claude', model: 'opus' }), null)
  // Derived from the allowlist, not sampled, so the ban can't rot into a
  // decoy: nothing the adapter accepts may be opus-5 or the poison alias.
  assertEquals(claude.models.includes('claude-opus-5'), false)
  assertEquals(claude.models.includes('opus'), false)
  // claude-opus-4-8 leads, so an explicit Claude request defaults to it.
  assertEquals(claude.models[0], 'claude-opus-4-8')
  // The menu offers Opus, and the model behind it is the pinned 4-8.
  assertEquals(claude.labels['claude-opus-4-8'], 'Opus')
  assertEquals(Object.keys(claude.labels)[0], 'claude-opus-4-8')
})

Deno.test('codex: the probed celestial line, with Sol as the default', () => {
  assertEquals(codex.models, [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ])
  assertEquals(codex.efforts, [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
  ])
  assertEquals(codex.labels, {
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
  })
  assertEquals(codex.models[0], 'gpt-5.6-sol')
})

Deno.test('codex-cli is the same process adapter under an explicit request', () => {
  let fallback = adapters['codex-cli']
  let job = {
    instruction: 'use the process floor',
    session_id: 'session',
    model: 'gpt-5.6-sol',
    effort: 'high',
  }
  assertEquals(fallback.argv(job), codex.argv(job))
  assertEquals(
    fallback.resume(job, 'thread', 'continue'),
    codex.resume(job, 'thread', 'continue'),
  )
  assertEquals(fallback.row, codex.row)
  // Same models, but no menu of its own and marked as the fallback transport.
  assertEquals(fallback.models, codex.models)
  assertEquals(fallback.labels, {})
  assertEquals(fallback.fallback, true)
})

Deno.test('ollama: direct model ids are provider offers, not adapters', () => {
  assertEquals(ollama.models[0], 'kimi-k2.7-code')
  assertEquals(ollama.models.includes('gpt-oss:120b'), true)
  assertEquals(
    ollama.models.some((model) => model.endsWith('-cloud')),
    false,
  )
  assertEquals(
    ollama.models.some((model) => model.endsWith(':cloud')),
    false,
  )
  assertEquals(ollama.labels['kimi-k2.7-code'], 'Kimi K2.7 Code')
  assertEquals('ollama' in adapters, false)
  assertEquals(
    trouble({ provider: 'ollama', model: 'kimi-k2.7-code' }),
    null,
  )
})

Deno.test('trouble: unknown provider/model/effort each name the valid ones', () => {
  assertMatch(
    trouble({ provider: 'oracle', model: 'x' })!,
    /unknown provider: oracle — have .*claude/,
  )
  assertMatch(
    trouble({ provider: 'claude', model: 'gpt-9' })!,
    /unknown model: gpt-9 — claude has .*opus/,
  )
  assertMatch(
    trouble({ provider: 'codex', model: 'gpt-5.6-sol', effort: 'heroic' })!,
    /unknown effort: heroic — codex has .*high/,
  )
  // a good codex request (effort in the allowlist) passes clean
  assertEquals(
    trouble({ provider: 'codex', model: 'gpt-5.6-sol', effort: 'high' }),
    null,
  )
})

// T-15352: a provider with no launch-effort knob (empty allowlist) IGNORES an
// effort rather than rejecting it — so switching a spawn onto claude never dies
// on an inherited/passed effort. A provider that offers efforts still rejects
// an unknown one (guarded above).
Deno.test('trouble: an empty effort allowlist ignores effort, never rejects', () => {
  assertEquals(claude.efforts, []) // premise: claude offers no launch effort
  assertEquals(
    trouble({ provider: 'claude', model: 'haiku', effort: 'high' }),
    null,
  )
  assertEquals(
    trouble({ provider: 'ollama', model: 'kimi-k3', effort: 'high' }),
    null,
  )
})

Deno.test('argv: no secrets, instruction rides last behind --', () => {
  let j = {
    instruction: 'do the thing',
    session_id: 'sid',
    model: 'haiku',
    effort: undefined,
  }
  assertEquals(claude.argv(j).at(-1), 'do the thing')
  assertEquals(claude.argv(j).at(-2), '--') // end-of-options guards the prompt
  assertEquals(claude.argv(j).includes('--session-id'), true)
  let c = codex.argv({ ...j, model: 'gpt-5.6-sol', effort: 'high' })
  assertEquals(c.at(-1), 'do the thing')
  assertEquals(c.at(-2), '--')
  assertEquals(c.includes('model_reasoning_effort=high'), true)
})

// The bug that started it: a persona's --- frontmatter (or any dash-leading
// instruction) must ride as a positional, never parse as a flag — -- sits
// immediately before it in every provider's argv.
Deno.test('argv: a dash-leading instruction stays a positional', () => {
  let j = {
    instruction: '---\ntitle: coder\n---\ndo it',
    session_id: 'sid',
    model: 'haiku',
    effort: undefined,
  }
  let c = claude.argv(j)
  assertEquals(c.at(-1), j.instruction)
  assertEquals(c.at(-2), '--')
  let x = codex.argv({ ...j, model: 'gpt-5.6-sol' })
  assertEquals(x.at(-1), j.instruction)
  assertEquals(x.at(-2), '--')
})

Deno.test('resume: an existing thread, the new prompt last', () => {
  let j = {
    instruction: 'more',
    session_id: 'ours',
    model: 'm',
    effort: undefined,
  }
  // claude: --resume names the thread; --session-id (which MINTS one) is gone
  let c = claude.resume(j, 'prov-123', 'and then?')
  assertEquals(c.at(-1), 'and then?')
  assertEquals(c.at(-2), '--') // the prompt rides behind end-of-options
  assertEquals(c.includes('--resume'), true)
  assertEquals(c[c.indexOf('--resume') + 1], 'prov-123')
  assertEquals(c.includes('--session-id'), false)
  // codex: `exec resume -- <id> <prompt>`, the posture flags kept
  let x = codex.resume(
    { ...j, model: 'gpt-5.6-sol', effort: 'high' },
    'th-9',
    'go on',
  )
  assertEquals(x.slice(0, 3), ['codex', 'exec', 'resume'])
  assertEquals(x.slice(-3), ['--', 'th-9', 'go on'])
  assertEquals(x.includes('--dangerously-bypass-approvals-and-sandbox'), true)
  assertEquals(x.includes('model_reasoning_effort=high'), true)
})

Deno.test('claude row: thinking dims, text says, tools chip, result closes', () => {
  let say = (t: string, c: unknown) => ({ type: t, message: { content: c } })
  assertEquals(
    claude.row(say('assistant', [{ type: 'thinking', thinking: 'hmm' }])),
    { kind: 'reason', text: 'hmm' },
  )
  assertEquals(
    claude.row(say('assistant', [{ type: 'text', text: 'OK' }])),
    { kind: 'say', role: 'agent', text: 'OK' },
  )
  // the event's clock rides the say — the transcript shows when it landed
  assertEquals(
    claude.row({
      ...say('assistant', [{ type: 'text', text: 'OK' }]),
      timestamp: '2026-07-25T19:50:31.529Z',
    }),
    { kind: 'say', role: 'agent', text: 'OK', at: '2026-07-25T19:50:31.529Z' },
  )
  // a tool chip's detail is the argument a human would ask about
  assertEquals(
    claude.row(say('assistant', [{
      type: 'tool_use',
      id: 'toolu_1',
      name: 'ToolSearch',
      input: { query: 'x' },
    }])),
    { kind: 'tool', name: 'ToolSearch', detail: 'x' },
  )
  // Bash is a command and says so: the command plus its description
  assertEquals(
    claude.row(say('assistant', [{
      type: 'tool_use',
      id: 'toolu_2',
      name: 'Bash',
      input: { command: 'ls -la', description: 'List files' },
    }])),
    { kind: 'exec', command: 'ls -la', desc: 'List files' },
  )
  // a user tool_result is its own line — its own chip, ok/✗ from is_error
  assertEquals(
    claude.row(say('user', [{
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: [{ type: 'tool_reference', tool_name: 'x' }],
      is_error: true,
    }])),
    {
      kind: 'tool',
      name: '↳',
      ok: false,
      error: '[{"type":"tool_reference","tool_name":"x"}]',
    },
  )
  assertEquals(
    claude.row({
      type: 'result',
      is_error: false,
      result: 'OK',
      usage: { input_tokens: 10, output_tokens: 38 },
    }),
    { kind: 'turn', usage: '{"input_tokens":10,"output_tokens":38}' },
  )
  assertEquals(
    claude.row({
      type: 'result',
      is_error: true,
      subtype: 'error_during_execution',
    }),
    { kind: 'error', text: 'result: error_during_execution' },
  )
  // system chatter earns a dim chip, not silence — and not a dump
  assertEquals(claude.row({ type: 'system', subtype: 'init' }), {
    kind: 'sys',
    tag: 'init',
  })
  assertEquals(
    claude.row({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 12345,
      estimated_tokens_delta: 100,
    }),
    { kind: 'sys', tag: 'thinking', text: '12k' },
  )
  assertEquals(
    claude.row({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'b1',
      description: 'Probe finished',
    }),
    { kind: 'sys', tag: 'notify', text: 'Probe finished' },
  )
  assertEquals(
    claude.row({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' },
    }),
    { kind: 'sys', tag: 'rate', text: 'five_hour allowed' },
  )
})

Deno.test('codex row: only item.completed narrates; turns divide', () => {
  assertEquals(
    codex.row({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'hi' },
    }),
    { kind: 'say', role: 'agent', text: 'hi' },
  )
  // a failed mcp tool call carries its error and an ✗
  assertEquals(
    codex.row({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'mcp_tool_call',
        server: 'tasks',
        tool: 'task_comment',
        arguments: { id: 'T-1' },
        error: { message: 'user cancelled MCP tool call' },
        status: 'failed',
      },
    }),
    {
      kind: 'tool',
      name: 'tasks.task_comment',
      ok: false,
      detail: '{"id":"T-1"}',
      error: 'user cancelled MCP tool call',
    },
  )
  assertEquals(
    codex.row({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'command_execution',
        command: "zsh -lc 'task --help'",
        exit_code: 127,
        status: 'failed',
      },
    }),
    {
      kind: 'exec',
      command: "zsh -lc 'task --help'",
      exit: 127,
      status: 'failed',
    },
  )
  assertEquals(
    codex.row({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'deno task check',
        exit_code: 0,
        status: 'completed',
      },
    }),
    {
      kind: 'exec',
      command: 'deno task check',
      exit: 0,
      status: 'completed',
    },
  )
  assertEquals(
    codex.row({
      type: 'turn.completed',
      usage: { input_tokens: 77954, output_tokens: 239 },
    }),
    { kind: 'turn', usage: '{"input_tokens":77954,"output_tokens":239}' },
  )
  assertEquals(
    codex.row({ type: 'turn.failed', error: { message: 'boom' } }),
    { kind: 'error', text: 'boom' },
  )
  // started events would double-render; a thread start is not narration
  assertEquals(
    codex.row({ type: 'item.started', item: { type: 'mcp_tool_call' } }),
    null,
  )
  assertEquals(codex.row({ type: 'thread.started', thread_id: 'x' }), null)
})

Deno.test('fake row: message says, tool chips, result closes the turn', () => {
  assertEquals(
    adapters.fake.row({ type: 'message', role: 'assistant', text: 'hi' }),
    { kind: 'say', role: 'agent', text: 'hi' },
  )
  assertEquals(
    adapters.fake.row({ type: 'tool', name: 'read' }),
    { kind: 'tool', name: 'read' },
  )
  assertEquals(
    adapters.fake.row({ type: 'result', usage: { output_tokens: 34 } }),
    { kind: 'turn', usage: '{"output_tokens":34}' },
  )
  assertEquals(adapters.fake.row({ type: 'init' }), null)
})
