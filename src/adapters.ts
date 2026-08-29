// The provider seam: what a managed session RUNS, and how to read what it
// prints. One hard-coded table — a provider is its argv, the two
// allowlists a start request is checked against, and the two readers that
// turn its JSONL into session summary columns. Every provider speaks the
// same shape (a line of JSON per event), so sessions.ts never learns a
// vendor's dialect: it asks the adapter "is this the init?", "is this the
// end?" and stamps whatever comes back.
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
  models: string[]
  efforts: string[]
  // The spawn menu: offered model → friendly name. A subset of models —
  // short aliases stay accepted but unoffered, so a form never shows the
  // same model twice. A fallback transport (below) carries no menu at all.
  labels: Record<string, string>
  // A CLI fallback transport: valid and directly requestable, but never a menu
  // entry of its own and always ranked behind the graph-native provider, so a
  // model it shares never appears twice in a picker.
  fallback?: boolean
  argv: (job: Job) => string[]
  // Resume a settled thread with more to say: the same flags as argv, but
  // pointed at an existing provider session and carrying the new prompt.
  resume: (job: Job, provider_session_id: string, text: string) => string[]
  init: (e: Event) => Summary | null
  terminal: (e: Event) => Summary | null
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

// The table as a browser may see it (GET /providers): the names, the
// two allowlists, and the friendly-named menu — nothing else; argv (and the
// paths in it) is this side's business. Derived, so a new provider needs
// no second edit.
// fake is a test rig, not an offer — it stays callable (tests, API smoke
// runs) but never shows up in a Run form.
// `ready` stamps per-provider readiness when the server passes an account
// probe; the default spawn blocker routes around any provider it marks unready,
// so a stamped /providers picks the graph-native → CLI transport for free.
export type ProviderSpec = Pick<Adapter, 'models' | 'efforts' | 'labels'> & {
  fallback?: boolean
}

// The `ollama` provider is a direct HTTP provider (the owner's ollama server,
// `ollama.yak.sh`), not an installed process adapter. These are the model ids
// it offers; they carry no `:cloud` suffix.
export let ollama: ProviderSpec = {
  models: [
    'kimi-k2.7-code',
    'glm-5.2',
    'gpt-oss:120b',
    'kimi-k2.6',
    'deepseek-v4-pro:preview',
    'mistral-large-3:675b',
    'kimi-k3',
    'gpt-oss:20b',
    'nemotron-3-ultra',
    'minimax-m2.7',
    'gemma4:31b',
    'deepseek-v4-flash:0731',
    'glm-5.1',
    'deepseek-v4-flash:preview',
    'nemotron-3-nano:30b',
    'minimax-m3',
    'nemotron-3-super',
    'deepseek-v4-pro:0813',
    'qwen3.5:397b',
  ],
  efforts: [],
  labels: {
    'kimi-k2.7-code': 'Kimi K2.7 Code',
    'glm-5.2': 'GLM-5.2',
    'gpt-oss:120b': 'GPT-OSS 120B',
    'kimi-k2.6': 'Kimi K2.6',
    'deepseek-v4-pro:preview': 'DeepSeek V4 Pro Preview',
    'mistral-large-3:675b': 'Mistral Large 3 675B',
    'kimi-k3': 'Kimi K3',
    'gpt-oss:20b': 'GPT-OSS 20B',
    'nemotron-3-ultra': 'Nemotron 3 Ultra',
    'minimax-m2.7': 'MiniMax M2.7',
    'gemma4:31b': 'Gemma 4 31B',
    'deepseek-v4-flash:0731': 'DeepSeek V4 Flash 0731',
    'glm-5.1': 'GLM-5.1',
    'deepseek-v4-flash:preview': 'DeepSeek V4 Flash Preview',
    'nemotron-3-nano:30b': 'Nemotron 3 Nano 30B',
    'minimax-m3': 'MiniMax M3',
    'nemotron-3-super': 'Nemotron 3 Super',
    'deepseek-v4-pro:0813': 'DeepSeek V4 Pro 0813',
    'qwen3.5:397b': 'Qwen 3.5 397B',
  },
}

export let providerSpec = (name: string): ProviderSpec | undefined =>
  name == 'ollama' ? ollama : adapters[name]

export let providers = (ready?: (name: string) => boolean) =>
  [...Object.entries(adapters), ['ollama', ollama] as const]
    .filter(([name]) => name != 'fake')
    .map(([name, a]) => ({
      name,
      models: a.models,
      efforts: a.efforts,
      labels: a.labels,
      ...(a.fallback ? { fallback: true } : {}),
      ...(ready ? { ready: ready(name) } : {}),
    }))

// A start request weighed against a provider's allowlists — the friendly
// gate the sugar tool answers BEFORE it mints a session, so a bad model is
// a clear error to the caller (naming the valid ones), never a doomed husk
// on the board. Null means it will launch. The created(session) effect
// re-checks in-transaction for the raw wire; this is the early door.
export let trouble = (
  { provider, model, effort }: {
    provider?: string
    model?: string
    effort?: string
  },
): string | null => {
  let spec = providerSpec(String(provider))
  if (!spec) {
    return `unknown provider: ${provider} — have ${
      providers().map((p) => p.name).join(', ')
    }`
  }
  if (!model || !spec.models.includes(model)) {
    return `unknown model: ${model} — ${provider} has ${spec.models.join(', ')}`
  }
  // An empty allowlist means the provider has no launch-time effort knob
  // (claude takes no --effort flag), so an effort that reaches it — passed,
  // inherited from the caller, or mirrored off a session/task hint — is a
  // no-op, not a failure. Only a provider that DOES offer efforts rejects an
  // unknown one, so a real typo (codex + 'heroic') still errors clearly.
  if (effort && spec.efforts.length && !spec.efforts.includes(effort)) {
    return `unknown effort: ${effort} — ${provider} has ${
      spec.efforts.join(', ')
    }`
  }
  return null
}

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
    models: ['fake-fast', 'fake-slow'],
    efforts: ['low', 'medium', 'high'],
    labels: { 'fake-fast': 'Fake Fast', 'fake-slow': 'Fake Slow' },
    argv: (j) => [
      Deno.execPath(),
      'run',
      '--quiet',
      '--allow-env=TASKS_ROLE',
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
      '--allow-env=TASKS_ROLE',
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
    // Pinned full ids ARE the offer — the version is part of it, so a
    // pinned id can't silently move when Anthropic ships. The CLI natively
    // resolves a short alias to the latest of its line (`sonnet`→latest
    // sonnet), so we accept those for the lines whose latest is what we
    // want. `opus` is NOT one of them: its latest is claude-opus-5, which is
    // barred, so opus is pinned to claude-opus-4-8 — the bare `opus` alias
    // is neither offered nor accepted, and a request for `opus` or
    // `claude-opus-5` is refused outright, never silently downgraded.
    // claude-opus-4-8[1m] is the same pinned 4-8, served with the 1M-token
    // context window — a first-party variant the CLI accepts, so it rides
    // the same pin (opus-5 stays barred either way).
    // claude-opus-4-8 leads, so it is the default when a caller explicitly
    // names Claude without a model. Probed live against the CLI.
    models: [
      'claude-opus-4-8',
      'claude-opus-4-8[1m]',
      'sonnet',
      'haiku',
      'fable',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ],
    // No launch-time effort knob — `claude -p` takes no --effort flag, so the
    // effort a claude run reports is observed, never selected here. Empty means
    // an effort passed/inherited to a claude spawn is IGNORED, not rejected
    // (adapters.trouble) — so switching provider to claude never dooms a spawn.
    efforts: [],
    // The MENU is the labels map. Opus is the pinned
    // 4-8; the other lines ride their alias, so the menu needs no edit when a
    // non-opus line ships a new latest.
    labels: {
      'claude-opus-4-8': 'Opus',
      'claude-opus-4-8[1m]': 'Opus 1M',
      fable: 'Fable',
      sonnet: 'Sonnet',
      haiku: 'Haiku',
    },
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
    // The celestial line, all probed live against the CLI.
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    labels: {
      'gpt-5.6-sol': 'GPT-5.6 Sol',
      'gpt-5.6-terra': 'GPT-5.6 Terra',
      'gpt-5.6-luna': 'GPT-5.6 Luna',
    },
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
// It carries no menu (`labels: {}`) — the same models are already offered once
// through graph-native `codex`, and this transport is chosen by readiness, not
// picked by name from a list. `fallback` ranks it behind `codex` everywhere.
adapters['codex-cli'] = {
  ...adapters.codex,
  labels: {},
  fallback: true,
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
