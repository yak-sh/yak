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
  for (let raw of blocks) {
    let mapped = claudeBlock(role, raw as Block, state)
    if (!mapped) continue
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
