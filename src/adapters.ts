// The provider seam: what a managed session RUNS, and how to read what it
// prints. A provider is its argv and the readers that turn its JSONL into
// session summary columns — code, and only code. WHICH providers exist, which
// models each admits and at which effort levels is graph data (catalog.ts):
// adding a model is a write, not a release. Every provider speaks the same
// shape (a line of JSON per event), so sessions.ts never learns a vendor's
// dialect: it asks the adapter "is this the init?", "is this the end?" and
// stamps whatever comes back.
//
// `fake` ships in-repo for tests; `claude` and `codex-cli` shell the
// installed CLIs (subscription auth rides HOME — no keys in argv or env).
// `codex` keeps this process adapter as the reliability floor even though
// managed requests bearing that name normally route to the graph runner.
// Event shapes below are copied from live probes of both CLIs, not docs.
import { kilo, type LogRow, type Session, type Tokens } from './types.ts'
import { codexTranscript } from './transcripts.ts'

// One parsed log line. Adapters own the dialect; anything they don't
// recognize is just log, not summary.
export type Event = Record<string, unknown>

// A patch of session summary facts — what an event teaches us. `error` (a
// known/expected failure state) and `exception` (a BREAK — the self-healing
// trigger, D-17081) are pseudo-columns sessions.ts stamp() routes to their own
// facet, not session columns; `exception` carries the optional JS stack a catch
// site holds. Adapters speak `error`; the lifecycle writer decides `exception`.
export type Summary = Partial<Session> & {
  error?: string | null
  exception?: { message: string; stack?: string | null }
}

// The job an adapter turns into a command line. A spawn always names a
// model (validated against the allowlist before launch); a RESUME may
// not — an external session only knows what it was serving if its
// transcript said so — and an unnamed model means "whatever the thread
// is already on", not a flag reading `null`.
export type Job = {
  instruction: string
  session_id: string
  model: string
  effort?: string
}

export type Adapter = {
  // The ingest dialect this provider's stream speaks (ingest.ts) — how the
  // file tailer turns each JSONL line into graph entries. Distinct from the
  // provider NAME: codex and its codex-cli fallback share one 'codex' dialect.
  // A plain string keeps this module free of the server-only ingest graph, so
  // the browser can still import the adapter table.
  dialect: 'claude' | 'codex' | 'fake'
  argv: (job: Job) => string[]
  // Resume a settled thread with more to say: the same flags as argv, but
  // pointed at an existing provider session and carrying the new prompt.
  resume: (job: Job, provider_session_id: string, text: string) => string[]
  init: (e: Event) => Summary | null
  terminal: (e: Event) => Summary | null
  // Some CLIs contaminate their promised JSONL stdout with a small set of
  // known, benign diagnostics. The adapter owns those vendor spellings just
  // as it owns the event dialect; every other non-JSON line remains a
  // malformed-stream diagnosis in sessions.ts.
  ignoreLine?: (line: string) => boolean
  // Facts an interactive transcript states outright. Unlike terminal(),
  // these never invent a lifecycle ending from conversation.
  observe?: (e: Event) => Summary | null
  // The dialect, normalized: one event → one renderer row (or null when the
  // line isn't worth showing — thread/turn starts, system init). This is the
  // ONLY place a vendor's shape is known; the browser reads LogRow, never a
  // provider's JSON.
  row: (e: Event) => LogRow | null
  // Interactive CLIs may persist a different dialect than the managed command
  // prints. Absent means row() already speaks both, as Claude's does.
  transcript?: (e: Event) => LogRow | null
  // The parsed `usage_json` a settled session stamped, normalized to the ONE
  // Tokens vocabulary (types.ts) — this is the only place a vendor's token
  // dialect is known, one reader beside init/terminal/row. Returns null when
  // the blob carried no token count at all; absent COUNTS stay absent (a field
  // a provider never reported must never fold to 0 — see usage.ts).
  usage?: (raw: unknown) => Tokens | null
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
    // deno-lint-ignore no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b./g, '') // ANSI paints garble chips
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

// The event's clock, when the dialect carries one — a say wears it so the
// transcript can show when each message landed. Spread, so a dialect
// without clocks (codex, fake) adds nothing.
let at = (e: Event) => e.timestamp ? { at: String(e.timestamp) } : {}

// --- usage normalization -------------------------------------------------
// The two providers report token counts in different shapes; these readers
// fold both into the ONE Tokens vocabulary (types.ts). Absent beats zero: a
// field the blob never carried stays OFF the object, so a downstream sum can
// tell "this provider never reported cache reads" from "it reported zero".

let record = (v: unknown): v is Record<string, unknown> =>
  typeof v == 'object' && v != null

// A raw count → a number, or undefined when it was absent/unparseable. This is
// the whole of absent-beats-zero: `?? 0` would erase the distinction here.
let count = (v: unknown): number | undefined => {
  if (v == null) return undefined
  let n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// Set key only when the value is present — the absent-beats-zero builder.
let put = (k: keyof Tokens, v?: number): Tokens => v == null ? {} : { [k]: v }

// Anthropic (claude, and the fake): input/cache tiers are already separate
// fields — no arithmetic, just rename. output_tokens_details.thinking is a
// SUBSET of output the bill already counts, so it folds into output.
export let anthropicUsage = (raw: unknown): Tokens | null => {
  if (!record(raw)) return null
  let u: Tokens = {
    ...put('input', count(raw.input_tokens)),
    ...put('cache_read', count(raw.cache_read_input_tokens)),
    ...put('cache_creation', count(raw.cache_creation_input_tokens)),
    ...put('output', count(raw.output_tokens)),
  }
  return Object.keys(u).length ? u : null
}

// Codex/OpenAI: `input_tokens` INCLUDES the cached reads, so subtract them to
// recover FRESH input and make it comparable to Anthropic's split. Codex has
// no cache-creation tier. Absence still wins: subtract only what was reported.
export let codexUsage = (raw: unknown): Tokens | null => {
  if (!record(raw)) return null
  let cached = count(raw.cached_input_tokens)
  let total = count(raw.input_tokens)
  let input = total == null ? undefined : Math.max(0, total - (cached ?? 0))
  let u: Tokens = {
    ...put('input', input),
    ...put('cache_read', cached),
    ...put('output', count(raw.output_tokens)),
  }
  return Object.keys(u).length ? u : null
}

// The fake provider ships in this repo: run it by absolute path — script
// AND binary. Deno.execPath() is the deno running this server, so the
// child never depends on the service manager's PATH carrying one.
let fake = new URL('./fake-provider.ts', import.meta.url).pathname

export let adapters: Record<string, Adapter> = {
  fake: {
    dialect: 'fake',
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
      '--', // the instruction rides after --, the contract the real CLIs need
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
      '--',
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
          ...(e.error ? { error: String(e.error) } : {}),
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
    usage: anthropicUsage,
  },

  // claude -p, stream-json: one JSON event per line. init announces the
  // session and the serving model; the `result` event is the last word.
  // --session-id hands the CLI OUR session uuid, so the provider's id and
  // ours are the same string — correlation for free.
  claude: {
    dialect: 'claude',
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
      // -- ends options: the instruction is a positional, so content that
      // opens with a dash (a persona's --- frontmatter, a task title like
      // "-x fix…") would otherwise parse as an unknown flag and exit 1
      // before any API call. Everything after -- is positional, always.
      '--',
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
      ...(j.model ? ['--model', j.model] : []),
      '--permission-mode',
      'bypassPermissions',
      '--', // the prompt is a positional — same flag-parse guard as argv
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
          ...(e.is_error
            ? {
              // Claude currently reports API refusals as subtype `success`
              // with is_error=true. The result carries the useful diagnosis;
              // retain the subtype fallback for execution errors without one.
              error: e.result
                ? String(e.result)
                : `result: ${String(e.subtype ?? 'error')}`,
            }
            : {}),
        }
        : null,
    // Claude's MCP client currently prints this capability warning to stdout
    // after its valid terminal result. It says only that an optional MCP
    // method is absent; treating it as transcript corruption turns a declared
    // quota refusal into a self-healing exception (T-26361).
    ignoreLine: (line) =>
      line ==
        'Client.listTools() called but server does not advertise tools capability - returning empty list',
    observe: (e) => {
      if (e.type != 'assistant') return null
      let message = e.message as { model?: unknown } | undefined
      let model = String(message?.model ?? '')
      if (!model) return null
      return {
        serving_model: model,
        ...(e.effort ? { effort: String(e.effort) } : {}),
      }
    },
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
            ...at(e),
          }
        }
        if (!b) return null
        if (b.type == 'thinking') {
          // Visible-thinking-off leaves an empty block: fold it into the
          // thinking-token run instead of printing a blank line.
          let text = String(b.thinking ?? '')
          return text.trim()
            ? { kind: 'reason', text }
            : { kind: 'sys', tag: 'thinking' }
        }
        if (b.type == 'text') {
          return {
            kind: 'say',
            role: e.type == 'user' ? 'user' : 'agent',
            text: String(b.text ?? ''),
            ...at(e),
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
            ...(e.duration_ms ? { ms: Number(e.duration_ms) } : {}),
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
    usage: anthropicUsage,
  },

  // codex exec --json. The stream never names its model, and text and
  // usage arrive in DIFFERENT events — so init() also harvests each
  // agent_message as it lands (drain merges every pass; the last one
  // standing is the final text) and turn.completed closes with usage.
  codex: {
    dialect: 'codex',
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
      // -- ends options: same flag-parse guard as claude (clap rejects a
      // dash-leading positional as an unknown argument otherwise).
      '--',
      j.instruction,
    ],
    // Resume: `exec resume <id> <prompt>` — the same posture flags as exec,
    // the id and the new prompt as the two positionals (options first, then
    // SESSION_ID then PROMPT, per `codex exec resume --help`). -- guards the
    // dash-leading prompt just as argv guards the instruction.
    resume: (j, sid, text) => [
      'codex',
      'exec',
      'resume',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      ...(j.model ? ['-m', j.model] : []),
      ...(j.effort ? ['-c', `model_reasoning_effort=${j.effort}`] : []),
      '--',
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
    transcript: codexTranscript,
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
            ...(it.status ? { status: String(it.status) } : {}),
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
    usage: codexUsage,
  },
}

// The direct runner owns `codex`; naming the substrate is the deliberate
// per-session escape hatch. Both process spellings share one implementation
// so the fallback cannot drift from the path a process-wide rollback uses.
// Which models it carries, and that it ranks behind graph-native codex, are
// the `provider` entity's business (catalog.ts): here it is the same code.
adapters['codex-cli'] = adapters.codex

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
