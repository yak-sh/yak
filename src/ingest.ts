// The ingest half of the file-first Session substrates: one source JSONL line
// → the ordered entry facets every reader already speaks (D-16704). drain()
// (sessions.ts) stamps the SUMMARY columns from each line; this module turns
// the SAME lines into the transcript rows, mapping each provider dialect to the
// existing wire-writable entry vocabulary — no provider-specific graph
// components — so an imported entry renders through entry_log's `shown()` path
// exactly like a graph-native one.
//
// A managed CLI session is one of two dialects, and the CLAUDE mapper is
// exported on its own so the Claude graph-native live stream (T-16815) reuses
// it verbatim rather than re-deriving the same block→entry rules. The mappers
// are pure Event → Batch: they mint their own entry eids (so a tool RESULT can
// name the CALL it answers), read the correlation map for cross-line results,
// and hand back the new call correlations for the caller to commit only after
// the append lands.
import type { EntrySpec } from './entries.ts'
import { uuid } from './types.ts'

// One parsed source line.
type Event = Record<string, unknown>

// Provider call_id → the eid of the call entry it minted. A tool result that
// arrives on a LATER line (claude emits `tool_use` then a separate
// `tool_result`) looks its call up here; a daemon restart rebuilds it from
// durable evidence (entries.ts `callKeys`), so correlation survives a crash.
export type IngestState = { calls: Map<string, string> }

// What one source line becomes: the entry specs (with their pre-minted eids,
// so intra-line result→call refs already resolve) plus any NEW call
// correlations to remember once the append commits. An empty `specs` means the
// line is not transcript history (a blank, a lifecycle/usage event, an
// unrecognized housekeeping item) — no entry, no coordinate.
export type Batch = {
  specs: EntrySpec[]
  ids: string[]
  calls: [string, string][]
}

let empty = (): Batch => ({ specs: [], ids: [], calls: [] })

// Credentials never enter an entry (D-16704). This is a light, transcript-
// preserving scrub — it redacts the shapes a real secret takes (bearer/basic
// headers, `sk-`/`ghp_`-style keys, JWTs, AWS ids, and `key: value` secret
// assignments) while leaving ordinary command output, code, and prose intact.
// The aggressive full-nuke scrub (codex_auth `codexMessage`) is reserved for
// the short normalized fault strings, not the body of the log.
export let scrub = (value: unknown): string => {
  let s = typeof value == 'string' ? value : JSON.stringify(value) ?? ''
  return s
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]')
    .replace(
      /\b(?:sk|sk-ant|sess|pk|rk|ghp|gho|ghs|ghu|ghr|xox[baprs])[-_][A-Za-z0-9_-]{8,}/gi,
      '[redacted]',
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
      '[redacted]',
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(
      /((?:api[_-]?key|secret|password|passwd|token|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[redacted]',
    )
}

// The one argument a human would ask about — the file, the pattern, the url —
// not a JSON blob, for a tool chip's dim detail.
let gist = (input: unknown): string => {
  let o = input as Record<string, unknown> | null
  for (
    let k of [
      'command',
      'file_path',
      'path',
      'pattern',
      'url',
      'query',
      'prompt',
      'description',
    ]
  ) {
    if (o && typeof o[k] == 'string' && o[k]) return scrub(o[k])
  }
  return scrub(input)
}

// Readable text out of a provider's nested content shape (a string, an array of
// {type,text} blocks, or an arbitrary object).
let textOf = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v == 'string') return v
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        x && typeof x == 'object' && typeof (x as Event).text == 'string'
          ? String((x as Event).text)
          : textOf(x)
      )
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(v) ?? ''
}

// ---- claude: `claude -p --output-format stream-json` ----

type Block = {
  type?: string
  text?: unknown
  thinking?: unknown
  id?: unknown
  name?: unknown
  input?: unknown
  tool_use_id?: unknown
  content?: unknown
  is_error?: unknown
}

// One assistant/user content block → its entry spec (+ any new correlation).
// A tool_use MINTS the call entry and remembers its id; the matching
// tool_result (a later `user` line) references it back.
let claudeBlock = (
  role: 'user' | 'agent',
  b: Block,
  state: IngestState,
): { spec: EntrySpec; id: string; call?: [string, string] } | null => {
  if (typeof b == 'string') {
    return {
      spec: { message: { role }, content: { body: scrub(b) } },
      id: uuid(),
    }
  }
  if (!b || typeof b != 'object') return null
  if (b.type == 'thinking') {
    let text = String(b.thinking ?? '')
    let spec: EntrySpec = text.trim()
      ? { reasoning: {}, content: { body: scrub(text) } }
      : { reasoning: {} }
    return { spec, id: uuid() }
  }
  if (b.type == 'text') {
    return {
      spec: {
        message: { role },
        content: { body: scrub(String(b.text ?? '')) },
      },
      id: uuid(),
    }
  }
  if (b.type == 'tool_use') {
    let id = uuid()
    let key = String(b.id ?? '')
    let name = String(b.name ?? '')
    let input = b.input as Record<string, unknown> | undefined
    let spec: EntrySpec = name == 'Bash'
      ? { call: { key }, bash: { command: scrub(input?.command) } }
      : { call: { key }, tool: { name, detail: gist(b.input) } }
    return { spec, id, call: key ? [key, id] : undefined }
  }
  if (b.type == 'tool_result') {
    let key = String(b.tool_use_id ?? '')
    let call = state.calls.get(key)
    let spec: EntrySpec = {
      result: call ? { call } : {},
      content: { body: scrub(textOf(b.content)) },
      // A tool-reported failure is a normal completed result (never error{}):
      // the outcome code carries it, so the chip shows ✓/✗ like the live row.
      exit: { code: b.is_error ? 1 : 0 },
    }
    return { spec, id: uuid() }
  }
  return null // an unmodeled block kind is not transcript history
}

// The reusable Claude dialect mapper (T-16815 imports this). One
// assistant/user event may carry SEVERAL content blocks — each becomes its own
// entry, all in one line's batch.
export let claudeEntries = (e: Event, state: IngestState): Batch => {
  if (e.type != 'assistant' && e.type != 'user') return empty()
  let role: 'user' | 'agent' = e.type == 'user' ? 'user' : 'agent'
  let msg = e.message as { content?: unknown } | undefined
  let content = msg?.content
  let blocks = Array.isArray(content) ? content : [content]
  let batch = empty()
  // A turn the human typed (or queued) at the prompt carries origin.kind
  // 'human'. Everything the harness injects as the user role — hook feedback,
  // task notifications, channel events, the compaction summary, the command
  // wrappers — is isMeta, promptSource 'system', or unmarked. The typed turn
  // wears the `prompt` tag, the same mark a managed run's brief wears, so a
  // reader asks the graph which user turns were said rather than a body prefix.
  let typed = role == 'user' &&
    (e.origin as Event | undefined)?.kind == 'human'
  for (let raw of blocks) {
    let mapped = claudeBlock(role, raw as Block, state)
    if (!mapped) continue
    if (typed && mapped.spec.message) mapped.spec.prompt = {}
    batch.specs.push(mapped.spec)
    batch.ids.push(mapped.id)
    if (mapped.call) batch.calls.push(mapped.call)
  }
  return batch
}

// ---- codex: `codex exec --json` (the codex-cli fallback shares this) ----

type Item = {
  id?: unknown
  type?: string
  text?: unknown
  command?: unknown
  aggregated_output?: unknown
  exit_code?: unknown
  status?: unknown
  server?: unknown
  tool?: unknown
  arguments?: unknown
  result?: unknown
  error?: { message?: unknown } | null
  changes?: unknown
  query?: unknown
  action?: unknown
}

// A codex outcome code: the process exit when present, else derived from the
// item's status. Non-zero is a normal result, not a fault.
let codexCode = (it: Item): number =>
  it.exit_code == null ? (it.status == 'failed' ? 1 : 0) : Number(it.exit_code)

// A whole tool item that arrives with its outcome inline (codex reports the
// call and its result as one `item.completed`) → a call entry plus its result
// entry, minted together so `result.call` names the call directly.
let codexTool = (
  call: EntrySpec,
  key: string,
  result: EntrySpec,
): Batch => {
  let callId = uuid()
  return {
    specs: [{ call: { key }, ...call }, {
      result: { call: callId },
      ...result,
    }],
    ids: [callId, uuid()],
    calls: key ? [[key, callId]] : [],
  }
}

// The reusable codex dialect mapper.
export let codexEntries = (e: Event, _state: IngestState): Batch => {
  if (e.type != 'item.completed') return empty()
  let it = (e as { item?: Item }).item
  if (!it || typeof it != 'object') return empty()
  let key = String(it.id ?? '')
  if (it.type == 'agent_message') {
    return {
      specs: [{
        message: { role: 'agent' },
        content: { body: scrub(it.text) },
      }],
      ids: [uuid()],
      calls: [],
    }
  }
  if (it.type == 'reasoning') {
    let text = String(it.text ?? '')
    return {
      specs: [
        text.trim()
          ? { reasoning: {}, content: { body: scrub(text) } }
          : { reasoning: {} },
      ],
      ids: [uuid()],
      calls: [],
    }
  }
  if (it.type == 'command_execution') {
    return codexTool(
      { bash: { command: scrub(it.command) } },
      key,
      {
        content: { body: scrub(it.aggregated_output) },
        exit: { code: codexCode(it) },
      },
    )
  }
  if (it.type == 'file_change') {
    let changes = Array.isArray(it.changes) ? it.changes as Event[] : []
    let paths = changes.map((c) => String(c.path ?? '')).filter(Boolean)
    return codexTool(
      { patch: { path: paths.join(', ') || '.', diff: scrub(it.changes) } },
      key,
      { exit: { code: codexCode(it) } },
    )
  }
  if (it.type == 'mcp_tool_call') {
    let failed = it.status == 'failed'
    let out = it.result as {
      content?: unknown
      structured_content?: { text?: unknown }
    } | undefined
    let body = scrub(
      textOf(out?.content) || String(out?.structured_content?.text ?? ''),
    )
    return codexTool(
      {
        tool: {
          name: `${it.server ?? ''}.${it.tool ?? ''}`,
          detail: gist(it.arguments),
        },
      },
      key,
      {
        content: { body },
        // A failed tool call is still a completed result: its message rides
        // stderr (never error{}), so the chip reads as a failure.
        ...(failed
          ? { stderr: { text: scrub(it.error?.message ?? 'tool call failed') } }
          : {}),
      },
    )
  }
  if (it.type == 'web_search') {
    return {
      specs: [{
        call: { key },
        tool: { name: 'web_search', detail: scrub(it.query ?? it.action) },
      }],
      ids: [uuid()],
      calls: key ? [[key, uuid()]] : [],
    }
  }
  return empty() // todo_list, error, and other housekeeping are not transcript rows
}

// ---- codex: the interactive rollout transcript ----
//
// Native `codex` writes ~/.codex/sessions/**/rollout-*.jsonl, and those lines
// are a DIFFERENT dialect than `codex exec --json` (codexEntries above): each
// is an `event_msg` or `response_item` envelope carrying a `payload`, never an
// `item.completed`. User and agent narration ride `event_msg`
// (user_message / agent_message); the tool calls ride `response_item`
// (`function_call` then a LATER `function_call_output`, correlated by call_id
// like claude's cross-line pair). `response_item:message` repeats that
// narration (and carries the developer/system instructions) — skipped, exactly
// as transcripts.ts already decided for the LogRow, which keeps the instruction
// text out of the graph too.

let payloadOf = (e: Event) => e.payload as Record<string, unknown> | undefined

// A shell command out of a codex tool call — `cmd` (exec_command), `command`
// (string or argv array), or a `local_shell` action's `command` argv.
let shellCommand = (v: unknown): string | undefined => {
  let o = v as Record<string, unknown> | null
  if (!o || typeof o != 'object') return
  let action = o.action as Record<string, unknown> | undefined
  let cmd = o.cmd ?? o.command ?? action?.command
  if (typeof cmd == 'string') return cmd
  if (Array.isArray(cmd)) return cmd.map((x) => String(x)).join(' ')
}

// A codex tool call's arguments arrive as a JSON string; parse it so gist() can
// find the one field worth previewing, else keep the raw text.
let parseArgs = (raw: unknown): unknown => {
  if (typeof raw != 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// The exit code a shell output announces in its own "exited with code N" line —
// the outcome without a separate event, mirrored from the managed stream's
// inline code (nonzero is a normal completed result, never error{}).
let exitOf = (text: string): number | undefined => {
  let m = text.match(/exited with code (\d+)/)
  return m ? Number(m[1]) : undefined
}

// A tool name that names a shell: exec_command, local_shell, a bare shell/bash.
// The command extraction is the real gate (a match with no command falls to a
// generic tool chip), so this staying loose never mislabels a non-shell tool.
let SHELL = /exec|shell|bash|command/i

let codexCall = (
  p: Record<string, unknown>,
  _state: IngestState,
): Batch => {
  let key = String(p.call_id ?? '')
  let name = String(p.name ?? '')
  let args = parseArgs(p.arguments ?? p.input)
  let command = SHELL.test(name)
    ? shellCommand(args) ?? shellCommand(p)
    : undefined
  let id = uuid()
  let spec: EntrySpec = command != null
    ? { call: { key }, bash: { command: scrub(command) } }
    : { call: { key }, tool: { name: name || 'tool', detail: gist(args) } }
  return { specs: [spec], ids: [id], calls: key ? [[key, id]] : [] }
}

let codexOutput = (
  p: Record<string, unknown>,
  state: IngestState,
): Batch => {
  let key = String(p.call_id ?? '')
  let call = state.calls.get(key)
  let out = p.output
  let obj = out && typeof out == 'object'
    ? out as Record<string, unknown>
    : undefined
  let body = obj ? textOf(obj.content) : String(out ?? '')
  // A tool that reports its own success, or a shell that printed its exit code:
  // the outcome rides exit{} (never error{}), so the chip reads ✓/✗.
  let code = obj
    ? (obj.success == null ? undefined : obj.success === false ? 1 : 0)
    : exitOf(body)
  let spec: EntrySpec = {
    result: call ? { call } : {},
    content: { body: scrub(body) },
    ...(code == null ? {} : { exit: { code } }),
  }
  return { specs: [spec], ids: [uuid()], calls: [] }
}

export let codexTranscriptEntries = (e: Event, state: IngestState): Batch => {
  if (e.type == 'event_msg') {
    let p = payloadOf(e)
    if (!p) return empty()
    if (p.type == 'user_message') {
      return {
        specs: [{
          message: { role: 'user' },
          content: { body: scrub(p.message) },
        }],
        ids: [uuid()],
        calls: [],
      }
    }
    if (p.type == 'agent_message') {
      return {
        specs: [{
          message: { role: 'agent' },
          content: { body: scrub(p.message) },
        }],
        ids: [uuid()],
        calls: [],
      }
    }
    return empty() // task_started/task_complete/token_count → summary, not history
  }
  if (e.type == 'response_item') {
    let p = payloadOf(e)
    if (!p) return empty()
    let type = String(p.type ?? '')
    if (type == 'reasoning') {
      let text = textOf(p.summary)
      return {
        specs: [
          text.trim()
            ? { reasoning: {}, content: { body: scrub(text) } }
            : { reasoning: {} },
        ],
        ids: [uuid()],
        calls: [],
      }
    }
    if (
      type == 'function_call' || type == 'custom_tool_call' ||
      type == 'local_shell_call'
    ) return codexCall(p, state)
    if (
      type == 'function_call_output' || type == 'custom_tool_call_output' ||
      type == 'local_shell_call_output'
    ) return codexOutput(p, state)
    return empty() // message (dup narration + instructions) and others: not a row
  }
  return empty()
}

// ---- fake: the in-repo test provider ----

let fakeEntries = (e: Event, _state: IngestState): Batch => {
  if (e.type == 'message') {
    return {
      specs: [{
        message: { role: e.role == 'user' ? 'user' : 'agent' },
        content: { body: scrub(e.text) },
      }],
      ids: [uuid()],
      calls: [],
    }
  }
  if (e.type == 'tool') {
    return {
      specs: [{
        call: { key: String(e.id ?? '') },
        tool: { name: String(e.name ?? ''), detail: scrub(e.detail) },
      }],
      ids: [uuid()],
      calls: [],
    }
  }
  return empty() // init/result are lifecycle+usage — summary, not history
}

// The one door drain() calls: dispatch a parsed line to its dialect's mapper.
// `dialect` is the adapter's own tag (adapters.ts), so codex-cli rides the
// codex mapper it shares everything else with.
export let ingestEntries = (
  dialect: string | undefined,
  e: Event,
  state: IngestState,
): Batch =>
  dialect == 'claude'
    ? claudeEntries(e, state)
    : dialect == 'codex'
    ? codexEntries(e, state)
    : dialect == 'fake'
    ? fakeEntries(e, state)
    : empty()

// The other door: an INTERACTIVE session's own provider transcript (sessions.ts
// trail()), a file the provider owns and whose dialect can differ from the
// managed stream's. Claude persists the same shape it prints, so claudeEntries
// serves both; codex's rollout is a distinct dialect, so it gets its own mapper.
// Same source-coordinate, cursor, and dedup as ingestEntries — only the line
// grammar differs.
export let ingestTranscript = (
  dialect: string | undefined,
  e: Event,
  state: IngestState,
): Batch =>
  dialect == 'claude'
    ? claudeEntries(e, state)
    : dialect == 'codex'
    ? codexTranscriptEntries(e, state)
    : dialect == 'fake'
    ? fakeEntries(e, state)
    : empty()
