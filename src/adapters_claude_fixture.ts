// A scrubbed, captured `claude -p --output-format stream-json --verbose`
// generation — the print-mode contract pinned against CLI 2.1.228 (T-16812,
// D-16810). Every line is a real event from a live probe with each free string
// replaced by an innocuous placeholder and every id/signature/path/token
// redacted: only the SHAPE is load-bearing here, never a value. This module is
// the ground truth the Claude generation transport (T-16814) and the entry
// mapper (T-16815) test against, so their readers meet the dialect the CLI
// actually speaks rather than a guess.
//
// The turn: a bounded generation that thinks, runs one built-in Bash tool
// INSIDE the subprocess, reads the result back on the same stream, then answers.
// Claude Code — not Tasks — executes that tool before Tasks ever sees it, which
// is why the tool_use and its tool_result arrive as two separate lines: the
// call, then its answer. usage/model numbers are real magnitudes kept small.
import type { Event } from './adapters.ts'

// The scrubbed thread id every line of the success stream carries. A real one
// is a v4 uuid the CLI mints (or that --session-id supplied); the transport
// records it as provider replay state (D-16810 continuity), never as lifecycle.
export let scrubbedSessionId = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'

// One completed generation, in emission order. system/hook_* lead when the
// worktree runs SessionStart hooks; they are housekeeping, dropped by init().
export let claudeStream: Event[] = [
  {
    type: 'system',
    subtype: 'hook_started',
    hook_event: 'SessionStart',
    hook_name: 'SessionStart',
    hook_id: 'hook-scrubbed',
    session_id: scrubbedSessionId,
    uuid: 'evt-scrubbed',
  },
  {
    type: 'system',
    subtype: 'hook_response',
    hook_event: 'SessionStart',
    hook_name: 'SessionStart',
    hook_id: 'hook-scrubbed',
    exit_code: 0,
    outcome: 'success',
    output: '<scrubbed>',
    stdout: '<scrubbed>',
    stderr: '',
    session_id: scrubbedSessionId,
    uuid: 'evt-scrubbed',
  },
  {
    // init: names the serving model and the provider thread. The reader consumes
    // {type, subtype, session_id, model}; the rest is faithful context — cwd is
    // the Session worktree, permissionMode is the bypassed-prompt posture the
    // managed door runs under, apiKeySource 'none' proves subscription auth (no
    // API key present), and tools/mcp_servers describe the in-subprocess host.
    type: 'system',
    subtype: 'init',
    session_id: scrubbedSessionId,
    cwd: '/tmp/session-worktree',
    model: 'claude-haiku-4-5-20251001',
    permissionMode: 'bypassPermissions',
    apiKeySource: 'none',
    claude_code_version: '2.1.228',
    tools: ['Bash', 'Read', 'Edit', 'Write'],
    mcp_servers: [{ name: 'tasks', status: 'connected' }],
    slash_commands: ['init', 'run'],
    output_style: 'default',
    uuid: 'evt-scrubbed',
  },
  {
    // A growing thinking-token estimate streams as its own system line; the view
    // squeezes the run to its last frame. Only the count is shown.
    type: 'system',
    subtype: 'thinking_tokens',
    estimated_tokens: 128,
    estimated_tokens_delta: 128,
    session_id: scrubbedSessionId,
    uuid: 'evt-scrubbed',
  },
  {
    // Assistant thinking. One content block per assistant line. `signature` is
    // an opaque provider replay token — redacted here; the entry mapper keeps it
    // as opaque(anthropic:…) evidence, never as user-facing text.
    type: 'assistant',
    timestamp: '2026-08-12T16:00:00.000Z',
    session_id: scrubbedSessionId,
    parent_tool_use_id: null,
    request_id: 'req-scrubbed',
    uuid: 'evt-scrubbed',
    message: {
      model: 'claude-haiku-4-5-20251001',
      id: 'msg-scrubbed',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'thinking',
        thinking: '<scrubbed reasoning>',
        signature: '<redacted-signature>',
      }],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 4,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 12000,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 0,
        },
        output_tokens: 40,
        service_tier: 'standard',
        inference_geo: '<scrubbed>',
      },
      diagnostics: null,
      context_management: null,
    },
  },
  {
    // The tool CALL. Claude Code runs this Bash inside the subprocess; Tasks only
    // observes it. `input.command` is my own innocuous probe input. `caller`
    // rides along ({type}) — the reader ignores it.
    type: 'assistant',
    timestamp: '2026-08-12T16:00:01.000Z',
    session_id: scrubbedSessionId,
    parent_tool_use_id: null,
    request_id: 'req-scrubbed',
    uuid: 'evt-scrubbed',
    message: {
      model: 'claude-haiku-4-5-20251001',
      id: 'msg-scrubbed',
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'toolu-scrubbed',
        name: 'Bash',
        input: {
          command: 'echo hello-from-probe',
          description: 'Echo a probe string',
        },
        caller: { type: 'direct' },
      }],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 4,
        cache_read_input_tokens: 12000,
        output_tokens: 72,
        service_tier: 'standard',
      },
      diagnostics: null,
      context_management: null,
    },
  },
  {
    // Subscription rate-limit posture arrives as its own line between turns.
    type: 'rate_limit_event',
    session_id: scrubbedSessionId,
    uuid: 'evt-scrubbed',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: 1760000000,
      rateLimitType: 'five_hour',
      overageStatus: 'disabled',
      overageDisabledReason: 'not_enrolled',
      isUsingOverage: false,
    },
  },
  {
    // The tool RESULT — a `user` line, its own chip. message.content[0] is the
    // tool_result the renderer reads; the top-level `tool_use_result` carries
    // the structured stdout/stderr the entry mapper can map to typed facets.
    type: 'user',
    timestamp: '2026-08-12T16:00:02.000Z',
    session_id: scrubbedSessionId,
    parent_tool_use_id: null,
    uuid: 'evt-scrubbed',
    message: {
      role: 'user',
      content: [{
        tool_use_id: 'toolu-scrubbed',
        type: 'tool_result',
        content: [{ type: 'text', text: 'hello-from-probe' }],
        is_error: false,
      }],
    },
    tool_use_result: {
      stdout: 'hello-from-probe',
      stderr: '',
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
    },
  },
  {
    // The final assistant answer — a plain text block.
    type: 'assistant',
    timestamp: '2026-08-12T16:00:03.000Z',
    session_id: scrubbedSessionId,
    parent_tool_use_id: null,
    request_id: 'req-scrubbed',
    uuid: 'evt-scrubbed',
    message: {
      model: 'claude-haiku-4-5-20251001',
      id: 'msg-scrubbed',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'It printed hello-from-probe.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 4,
        cache_read_input_tokens: 12000,
        output_tokens: 12,
        service_tier: 'standard',
      },
      diagnostics: null,
      context_management: null,
    },
  },
  {
    // The terminal result closes the turn: final text, normalized usage, the
    // stop_reason, and cost. subtype 'success' with is_error false is delivery.
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'It printed hello-from-probe.',
    session_id: scrubbedSessionId,
    stop_reason: 'end_turn',
    num_turns: 2,
    duration_ms: 4200,
    duration_api_ms: 3900,
    total_cost_usd: 0.002,
    permission_denials: [],
    usage: {
      input_tokens: 8,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 24000,
      output_tokens: 124,
      output_tokens_details: { thinking_tokens: 40 },
      service_tier: 'standard',
    },
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 8,
        outputTokens: 124,
        cacheReadInputTokens: 24000,
        cacheCreationInputTokens: 0,
        costUSD: 0.002,
        contextWindow: 200000,
        canonicalModel: 'claude-haiku-4-5',
        provider: 'anthropic',
      },
    },
    uuid: 'evt-scrubbed',
  },
]

// A resume aimed at a thread that was never persisted (a prior generation ran
// with --no-session-persistence, or the daemon lost the thread). The CLI exits
// 1 with "No conversation found with session ID: <uuid>" on stderr AND emits
// this single terminal line on stdout: subtype error_during_execution,
// is_error true, an `errors` array. This is the durable-error contract the
// runner stamps (D-16810 recovery), captured live and scrubbed.
export let claudeResumeMissing: Event = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  session_id: scrubbedSessionId,
  stop_reason: null,
  num_turns: 0,
  duration_ms: 30,
  duration_api_ms: 0,
  total_cost_usd: 0,
  permission_denials: [],
  errors: [{ message: 'No conversation found with session ID' }],
  usage: { input_tokens: 0, output_tokens: 0 },
  modelUsage: {},
  uuid: 'evt-scrubbed',
}
