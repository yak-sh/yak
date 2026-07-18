// The provider seam: what a managed session RUNS, and how to read what it
// prints. One hard-coded table — a provider is its argv, the two
// allowlists a start request is checked against, and the two readers that
// turn its JSONL into session summary columns. Every provider speaks the
// same shape (a line of JSON per event), so sessions.ts never learns a
// vendor's dialect: it asks the adapter "is this the init?", "is this the
// end?" and stamps whatever comes back.
//
// `fake` ships in-repo for tests; `claude` and `codex` shell the installed
// CLIs (subscription auth rides HOME — no keys in argv, no keys in env).
// Event shapes below are copied from live probes of both CLIs, not docs.
import { kilo, type LogRow, type Session } from './types.ts'

// One parsed log line. Adapters own the dialect; anything they don't
// recognize is just log, not summary.
export type Event = Record<string, unknown>

// A patch of session summary columns — what an event teaches us.
export type Summary = Partial<Session>

// The job an adapter turns into a command line.
export type Job = {
  instruction: string
  session_id: string
  model: string
  effort?: string
}

export type Adapter = {
  models: string[]
  efforts: string[]
  argv: (job: Job) => string[]
  // Resume a settled thread with more to say: the same flags as argv, but
  // pointed at an existing provider session and carrying the new prompt.
  resume: (job: Job, provider_session_id: string, text: string) => string[]
  init: (e: Event) => Summary | null
  terminal: (e: Event) => Summary | null
  // The dialect, normalized: one event → one renderer row (or null when the
  // line isn't worth showing — thread/turn starts, system init). This is the
  // ONLY place a vendor's shape is known; the browser reads LogRow, never a
  // provider's JSON.
  row: (e: Event) => LogRow | null
}

// A claude message content block, as much of it as row() reads.
type Block = {
  type?: string
  text?: unknown
  thinking?: unknown
  name?: unknown
  input?: unknown
  content?: unknown
  is_error?: unknown
}

// A one-line, bounded preview of a tool's arguments or a result's body —
// dim detail on a chip, so it stays small on the wire and on one line.
let preview = (v: unknown): string => {
  let s = (typeof v == 'string' ? v : JSON.stringify(v) ?? '')
    .replace(/\s+/g, ' ').trim()
  return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

// The one argument a human would ask about — a tool chip should say
// "the file", "the pattern", "the url", not a JSON blob. The order is
// specificity: the first present field wins; unknown shapes keep the
// JSON preview.
let gist = (input: unknown): string => {
  let o = input as Record<string, unknown> | null
  for (
    const k of [
      'command',
      'file_path',
      'pattern',
      'url',
      'query',
      'description',
      'prompt',
      'skill',
    ]
  ) {
    if (o && typeof o[k] == 'string' && o[k]) return preview(o[k])
  }
  return preview(input)
}

// The table as a browser may see it (GET /providers): the names and the
// two allowlists a Run form offers, and nothing else — argv (and the
// paths in it) is this side's business. Derived, so a new provider needs
// no second edit.
// fake is a test rig, not an offer — it stays callable (tests, API smoke
// runs) but never shows up in a Run form.
export let providers = () =>
  Object.entries(adapters)
    .filter(([name]) => name != 'fake')
    .map(([name, a]) => ({
      name,
      models: a.models,
      efforts: a.efforts,
    }))

// The fake provider ships in this repo: run it by absolute path — script
// AND binary. Deno.execPath() is the deno running this server, so the
// child never depends on the service manager's PATH carrying one.
let fake = new URL('./fake-provider.ts', import.meta.url).pathname

export let adapters: Record<string, Adapter> = {
  fake: {
    models: ['fake-fast', 'fake-slow'],
    efforts: ['low', 'medium', 'high'],
    argv: (j) => [
      Deno.execPath(),
      'run',
      '--quiet',
      fake,
      '--session',
      j.session_id,
      '--model',
      j.model,
      ...(j.effort ? ['--effort', j.effort] : []),
      j.instruction,
    ],
    // Resume: same script, minus the fresh session id (the thread already
    // exists — `--resume` tells the fake to skip its init), the new prompt
    // last. Enough to drive the whole input path with no model or key.
    resume: (j, sid, text) => [
      Deno.execPath(),
      'run',
      '--quiet',
      fake,
      '--session',
      sid,
      '--model',
      j.model,
      ...(j.effort ? ['--effort', j.effort] : []),
      '--resume',
      text,
    ],
    init: (e) =>
      e.type == 'init'
        ? {
          status: 'running',
          provider_session_id: String(e.session_id ?? ''),
          serving_model: String(e.model ?? ''),
        }
        : null,
    terminal: (e) =>
      e.type == 'result'
        ? {
          final_text: e.final_text == null ? null : String(e.final_text),
          usage_json: e.usage ? JSON.stringify(e.usage) : null,
        }
        : null,
    row: (e) => {
      if (e.type == 'message') {
        return {
          kind: 'say',
          role: e.role == 'user' ? 'user' : 'agent',
          text: String(e.text ?? ''),
        }
      }
      if (e.type == 'tool') return { kind: 'tool', name: String(e.name ?? '') }
      if (e.type == 'result') {
        return {
          kind: 'turn',
          usage: e.usage ? JSON.stringify(e.usage) : undefined,
        }
      }
      return null // init announces, it doesn't narrate
    },
  },

  // claude -p, stream-json: one JSON event per line. init announces the
  // session and the serving model; the `result` event is the last word.
  // --session-id hands the CLI OUR session uuid, so the provider's id and
  // ours are the same string — correlation for free.
  claude: {
    // Full ids, not aliases — the version is part of the offer (an alias
    // silently moves when Anthropic ships). Probed live against the CLI.
    models: [
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ],
    efforts: [],
    argv: (j) => [
      'claude',
      '-p',
      '--session-id',
      j.session_id,
      '--output-format',
      'stream-json',
      '--verbose', // stream-json in print mode requires it
      '--model',
      j.model,
      '--permission-mode',
      'bypassPermissions', // it owns its worktree; nobody is at the prompt
      j.instruction,
    ],
    // Resume: --resume <id> takes the place of --session-id (the CLI won't
    // accept both — one names an existing thread, the other mints one); the
    // rest of the flags, and the discipline, are argv's.
    resume: (j, sid, text) => [
      'claude',
      '-p',
      '--resume',
      sid,
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      j.model,
      '--permission-mode',
      'bypassPermissions',
      text,
    ],
    init: (e) =>
      e.type == 'system' && e.subtype == 'init'
        ? {
          status: 'running',
          provider_session_id: String(e.session_id ?? ''),
          serving_model: String(e.model ?? ''),
        }
        : null,
    terminal: (e) =>
      e.type == 'result'
        ? {
          final_text: e.result == null ? null : String(e.result),
          usage_json: e.usage ? JSON.stringify(e.usage) : null,
          ...(e.is_error ? { error: `result: ${e.subtype}` } : {}),
        }
        : null,
    // stream-json: one content block per assistant/user event here (probed
    // live). thinking → reason, text → say; a tool_use is the call, the
    // matching user tool_result its answer (a separate line, so its own
    // chip — row() is per-line and can't correlate the two). The result
    // event closes the turn with usage; its text just repeats the last say.
    row: (e) => {
      if (e.type == 'assistant' || e.type == 'user') {
        let msg = e.message as { content?: unknown } | undefined
        let c = msg?.content
        let b = (Array.isArray(c) ? c[0] : c) as Block | string | undefined
        if (typeof b == 'string') {
          return {
            kind: 'say',
            role: e.type == 'user' ? 'user' : 'agent',
            text: b,
          }
        }
        if (!b) return null
        if (b.type == 'thinking') {
          return { kind: 'reason', text: String(b.thinking ?? '') }
        }
        if (b.type == 'text') {
          return {
            kind: 'say',
            role: e.type == 'user' ? 'user' : 'agent',
            text: String(b.text ?? ''),
          }
        }
        if (b.type == 'tool_use') {
          // Bash is a command, and says so: the command plus the model's
          // own description of what it's for.
          if (b.name == 'Bash') {
            let i = b.input as { command?: unknown; description?: unknown }
            return {
              kind: 'exec',
              command: String(i?.command ?? ''),
              ...(i?.description ? { desc: String(i.description) } : {}),
            }
          }
          return {
            kind: 'tool',
            name: String(b.name ?? ''),
            detail: gist(b.input),
          }
        }
        if (b.type == 'tool_result') {
          return b.is_error
            ? { kind: 'tool', name: '↳', ok: false, error: preview(b.content) }
            : { kind: 'tool', name: '↳', ok: true, detail: preview(b.content) }
        }
        return null
      }
      if (e.type == 'result') {
        return e.is_error
          ? { kind: 'error', text: `result: ${String(e.subtype ?? 'error')}` }
          : {
            kind: 'turn',
            usage: e.usage ? JSON.stringify(e.usage) : undefined,
          }
      }
      // Housekeeping, said small (shapes from live probes). thinking_tokens
      // streams a growing estimate — the view squeezes the run to its last
      // frame, so the text is just the current count.
      if (e.type == 'system') {
        let sub = String(e.subtype ?? '')
        if (sub == 'thinking_tokens') {
          return {
            kind: 'sys',
            tag: 'thinking',
            text: kilo(Number(e.estimated_tokens ?? 0)),
          }
        }
        if (sub == 'hook_started' || sub == 'hook_response') {
          return {
            kind: 'sys',
            tag: 'hook',
            text: `${e.hook_name ?? ''}${sub == 'hook_response' ? ' ✓' : ''}`,
          }
        }
        if (sub == 'task_started' || sub == 'task_notification') {
          return {
            kind: 'sys',
            tag: sub == 'task_started' ? 'spawn' : 'notify',
            text: String(e.description ?? ''),
          }
        }
        if (sub == 'background_tasks_changed') {
          let n = Array.isArray(e.tasks) ? e.tasks.length : 0
          return {
            kind: 'sys',
            tag: 'tasks',
            text: n ? `${n} in the background` : 'background idle',
          }
        }
        return { kind: 'sys', tag: sub || 'system' }
      }
      if (e.type == 'rate_limit_event') {
        let i = e.rate_limit_info as
          | { status?: unknown; rateLimitType?: unknown }
          | undefined
        return {
          kind: 'sys',
          tag: 'rate',
          text: `${i?.rateLimitType ?? ''} ${i?.status ?? ''}`.trim(),
        }
      }
      return null
    },
  },

  // codex exec --json. The stream never names its model, and text and
  // usage arrive in DIFFERENT events — so init() also harvests each
  // agent_message as it lands (drain merges every pass; the last one
  // standing is the final text) and turn.completed closes with usage.
  codex: {
    // The celestial line, all probed live against the CLI.
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    efforts: ['low', 'medium', 'high', 'xhigh'],
    argv: (j) => [
      'codex',
      'exec',
      '--json',
      // No approvals, no sandbox — the owner's call (2026-07-17): a
      // headless exec has no user to approve, approvals_reviewer=user
      // auto-cancels every MCP call, and auto_review taxed each call
      // with a reviewer pass. The session's worktree is its blast
      // radius. Revisit with T-3593 if the posture changes.
      '--dangerously-bypass-approvals-and-sandbox',
      '-m',
      j.model,
      ...(j.effort ? ['-c', `model_reasoning_effort=${j.effort}`] : []),
      j.instruction,
    ],
    // Resume: `exec resume <id> <prompt>` — the same posture flags as exec,
    // the id and the new prompt as the two positionals (options first, then
    // SESSION_ID then PROMPT, per `codex exec resume --help`).
    resume: (j, sid, text) => [
      'codex',
      'exec',
      'resume',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-m',
      j.model,
      ...(j.effort ? ['-c', `model_reasoning_effort=${j.effort}`] : []),
      sid,
      text,
    ],
    init: (e) => {
      if (e.type == 'thread.started') {
        return {
          status: 'running',
          provider_session_id: String(e.thread_id ?? ''),
        }
      }
      let item = (e as { item?: { type?: string; text?: string } }).item
      if (e.type == 'item.completed' && item?.type == 'agent_message') {
        return { final_text: item.text ?? null }
      }
      return null
    },
    terminal: (e) =>
      e.type == 'turn.completed'
        ? { usage_json: e.usage ? JSON.stringify(e.usage) : null }
        : e.type == 'turn.failed'
        ? {
          error: String(
            (e as { error?: { message?: string } }).error?.message ??
              'turn failed',
          ),
        }
        : null,
    // Only item.COMPLETED narrates — item.started would double every row.
    // A tool call arrives whole (server.tool, its status, its error); a
    // command carries its own exit. turn.completed is the usage divider.
    row: (e) => {
      if (e.type == 'item.completed') {
        let it = (e as { item?: Item }).item
        if (!it) return null
        if (it.type == 'agent_message') {
          return { kind: 'say', role: 'agent', text: String(it.text ?? '') }
        }
        if (it.type == 'reasoning') {
          return { kind: 'reason', text: String(it.text ?? '') }
        }
        if (it.type == 'mcp_tool_call') {
          return {
            kind: 'tool',
            name: `${it.server ?? ''}.${it.tool ?? ''}`,
            ok: it.status != 'failed',
            detail: gist(it.arguments),
            ...(it.error?.message ? { error: String(it.error.message) } : {}),
          }
        }
        if (it.type == 'command_execution') {
          return {
            kind: 'exec',
            command: String(it.command ?? ''),
            ...(it.exit_code == null ? {} : { exit: Number(it.exit_code) }),
          }
        }
        return null
      }
      if (e.type == 'turn.completed') {
        return {
          kind: 'turn',
          usage: e.usage ? JSON.stringify(e.usage) : undefined,
        }
      }
      if (e.type == 'turn.failed') {
        return {
          kind: 'error',
          text: String(
            (e as { error?: { message?: string } }).error?.message ??
              'turn failed',
          ),
        }
      }
      return null // thread.started, turn.started, item.started
    },
  },
}

// A codex item, as much of it as row() reads.
type Item = {
  type?: string
  text?: unknown
  server?: unknown
  tool?: unknown
  arguments?: unknown
  status?: unknown
  error?: { message?: unknown } | null
  command?: unknown
  exit_code?: unknown
}
