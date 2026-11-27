// What a harness's log says, one line at a time. Each agent CLI (Claude Code,
// Codex, Grok Build, Gemini CLI, Antigravity CLI) writes one JSON object per
// line, to a transcript file of its own and to stdout when a managed run is
// read (@yaks/spawn), and a reader turns one line into the entries it becomes:
// what a person typed, what the harness put in front of the model, what the
// model said and thought, and the tool calls the harness ran with what they
// returned. Code, and only code: which file belongs to which session, and
// what the graph makes of an entry, is the importer's (./tail.ts).
//
// A reader knows a format and nothing about the graph, so what it reports
// carries no eids. It names each call's tool by name and the call by the
// harness's own id, and a result names its call by that same id; the importer
// turns both into entities. The kind of each entry is the transcript's own
// vocabulary (./native.ts):
//
//   content                  what a person typed: prose alone is an input
//   content + notice         what the harness put in front of the model
//   content + output         what the model said
//   content + reasoning      what it thought, marked output as well
//   call{to, id, args}       a tool it called, by the tool's name
//   result{call} + content   what the tool returned, and `execution{state}`
//                            saying whether the call went through
//   stop, usage, cost, refusal the end of a managed turn, and what it cost
//
// A tool's arguments and output pass through `scrub()`, since a command's
// output is where a credential turns up. A person's words and the model's are
// kept verbatim.
//
// The stream shapes are copied from live runs of each CLI, and Claude Code's
// and Codex's files from the files they keep; Grok's and Antigravity's files
// follow third-party descriptions until they are read from real ones
// (T-2761).

import { metered } from '@yaks/claude/limits'
import type { Limit } from '@yaks/model'
import { claudeStops } from './claude-control.ts'
export type { Limit }
import { type Fixed, instructionParts, toolPart } from './parts.ts'

/** One parsed line of a harness's log. */
export type Event = Record<string, unknown>

/** The components of one entry, as a reader reports them. */
export type Comps = Record<string, Record<string, unknown>>

/** What one line says. */
export type Said = {
  /** the entries it becomes, in order */
  entries: Comps[]
  /** what it says about the session itself: the harness's own id for it */
  about?: Comps
  /** when the harness wrote it, where the line says */
  at?: string
  /** what it says about the fixed part every request carries (./parts.ts) */
  fixed?: Fixed[]
  /** what it says about the provider's plan limits */
  limits?: Limit[]
  /** the model it says answers the lines after it, by the model's own name */
  model?: string
  /** a fragment of an entry the lines after it carry on, where a stream
   * prints a reply in pieces: a run of parts of one `key` is one entry, at
   * the line of its first, and any other line ends the run (./tail.ts) */
  part?: { key: string; entry: Comps }
}

/** A harness's line format. */
export type Reader = (e: Event) => Said

/**
 * A reader whose plan limits are one account's: the account that keeps the
 * transcript, or the one a run signs in with. A reading that names no account
 * is a different row from the same plan's reading that names one.
 *
 * ```ts
 * import { accounted, claude } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let week = { utilization: 0.25, resetsAt: 1794913200 }
 * let line = { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { seven_day: week } } }
 * assertEquals(accounted(claude, 'a')(line).limits?.[0].account, 'a')
 * ```
 */
export let accounted = (read: Reader, account?: string): Reader =>
  account
    ? (e) => {
      let said = read(e)
      return said.limits
        ? { ...said, limits: said.limits.map((l) => ({ ...l, account })) }
        : said
    }
    : read

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let obj = (v: unknown): Event =>
  v && typeof v == 'object' && !Array.isArray(v) ? v as Event : {}
let list = (v: unknown): Event[] => Array.isArray(v) ? v.map(obj) : []
let nothing: Said = { entries: [] }

// Readable text out of a content shape: a string, or blocks of which the text
// ones count.
let text = (v: unknown): string =>
  typeof v == 'string'
    ? v
    : list(v).filter((b) => b.type == 'text').map((b) => str(b.text))
      .join('\n')

/**
 * A credential's shape, redacted: a bearer or basic header, a vendor key, a
 * JWT, an AWS key id, or a `key: value` assignment naming a secret. Ordinary
 * output, code and prose pass through.
 *
 * ```ts
 * import { scrub } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(scrub('curl -H "Authorization: Bearer abc.def"'), 'curl -H "Authorization: [redacted]"')
 * assertEquals(scrub('token=ghp_0123456789abcdef'), 'token=[redacted]')
 * assertEquals(scrub('ls -la'), 'ls -la')
 * assertEquals(scrub('value: yak_secret_example'), 'value: [set]')
 * ```
 */
export let scrub = (s: string): string =>
  s
    .replace(/\byak_secret_[A-Za-z0-9_-]+/g, '[set]')
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
      /((?:api[_-]?key|secret|password|passwd|token|authorization)["']?\s*[:=]\s*)(?!\[redacted\])(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[redacted]',
    )

// Every string inside a value, scrubbed: arguments are an object, and a
// pattern run over its JSON would eat the quotes around what it redacts.
let scrubbed = (v: unknown): unknown =>
  typeof v == 'string'
    ? scrub(v)
    : Array.isArray(v)
    ? v.map(scrubbed)
    : v && typeof v == 'object'
    ? Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, scrubbed(x)]),
    )
    : v

let said = (body: string, marks: Comps = {}): Comps[] =>
  body.trim() ? [{ content: { body }, ...marks }] : []

let call = (to: string, id: unknown, args: unknown): Comps => ({
  call: { to, id: String(id ?? ''), args: obj(scrubbed(args)) },
})

let result = (id: unknown, body: string, failed: boolean): Comps => ({
  result: { call: String(id ?? '') },
  content: { body: scrub(body) },
  execution: {},
  ...(failed ? { refusal: { code: 'is_error' } } : {}),
})

// A count a harness reported, or nothing. Absent beats zero: a tier a vendor
// never reports must not fold to 0, or a sum cannot tell the two apart.
let count = (v: unknown): number | undefined => {
  if (v == null) return undefined
  let n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

let put = (k: string, v?: number) => v == null ? {} : { [k]: v }

// @yaks/model's `usage`, whose `input_tokens` counts every input token, cached
// ones included: what Codex reports. Claude reports its cache reads and writes
// beside an `input_tokens` that counts only the rest, so they are added in.
let usage = (
  input?: number,
  output?: number,
  cached?: number,
  more: Record<string, number | undefined> = {},
): Comps => {
  let told = {
    ...put('input_tokens', input),
    ...put('output_tokens', output),
    ...put('cached_tokens', cached),
    ...Object.assign({}, ...Object.entries(more).map(([k, n]) => put(k, n))),
  }
  return Object.keys(told).length ? { usage: told } : {}
}

let claudeUsage = (raw: unknown): Comps => {
  let u = obj(raw)
  let parts = [
    u.input_tokens,
    u.cache_read_input_tokens,
    u.cache_creation_input_tokens,
  ].map(count)
  return usage(
    parts.every((n) => n == null)
      ? undefined
      : parts.reduce((a: number, n) => a + (n ?? 0), 0),
    count(u.output_tokens),
    count(u.cache_read_input_tokens),
    {
      cache_write_tokens: count(u.cache_creation_input_tokens),
      cache_write_1h_tokens: count(
        obj(u.cache_creation).ephemeral_1h_input_tokens,
      ),
      reasoning_tokens: count(obj(u.output_tokens_details).thinking_tokens),
    },
  )
}

let codexUsage = (raw: unknown): Comps => {
  let u = obj(raw)
  return usage(
    count(u.input_tokens),
    count(u.output_tokens),
    count(u.cached_input_tokens),
    {
      cache_write_tokens: count(u.cache_write_input_tokens),
      reasoning_tokens: count(u.reasoning_output_tokens),
    },
  )
}

// The API request a reply answers. Claude Code writes each block of a reply on
// a line of its own, every one naming the request and its final usage; the
// importer keeps the first, and enters it before the blocks it returned
// (./tail.ts `imported`). It follows them here, so they keep the places, and
// the names, an import from before requests were read gave them.
let requested = (e: Event): Comps[] => {
  let m = obj(e.message)
  let model = str(m.model)
  let used = claudeUsage(m.usage)
  let id = str(m.id) || str(e.requestId)
  return id && model != '<synthetic>' && Object.keys(used).length
    ? [{ ask: { id, ...(model ? { to: model } : {}) }, ...used }]
    : []
}

let home = (path: string) => path.replace(/^\/home\/[^/]+(?=\/)/, '~')

// What a line sent the model, in characters: what Claude Code rendered.
let shown = (e: Event, fallback = '') =>
  list(e.rendered).map((r) => str(r.content)).join('').length ||
  fallback.length

// What Claude Code says about the fixed part every request carries: its system
// prompt and tool schemas, the instruction files, and its listings.
let fixedOf = (e: Event): Fixed[] => {
  let a = obj(e.attachment)
  return e.type != 'attachment' ? [] : a.type == 'prompt_snapshot'
    ? [
      {
        source: 'system',
        parts: (Array.isArray(a.systemPrompt) ? a.systemPrompt : [])
          .flatMap((p) => instructionParts(str(p), 'system')),
      },
      ...list(a.tools).length
        ? [{ source: 'tools', parts: list(a.tools).map(toolPart) }]
        : [],
    ]
    : a.type == 'instructions'
    ? [{
      source: 'instructions',
      parts: list(a.files).flatMap((f) =>
        instructionParts(str(f.content), `instructions ${home(str(f.path))}`)
      ),
    }]
    : a.type == 'skill_listing'
    ? [{
      source: 'skills',
      parts: [['skills', shown(e, str(a.content))]],
      add: !a.isInitial,
    }]
    : a.type == 'deferred_tools_delta'
    ? [{
      source: 'deferred',
      parts: [['deferred tools', shown(e)]],
      add: true,
    }]
    : a.type == 'mcp_instructions_delta'
    ? [{ source: 'mcp', parts: [['mcp instructions', shown(e)]], add: true }]
    : a.type == 'agent_listing_delta'
    ? [{
      source: 'agents',
      parts: [['agent listing', shown(e)]],
      add: !a.isInitial,
    }]
    : []
}

// A slash command is recorded as its wrapper; the person typed the command.
let typedAs = (text: string): string => {
  let name = text.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]
  if (!name) return text
  let args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]
  return args?.trim() ? `${name.trim()} ${args.trim()}` : name.trim()
}

// What the harness says a person typed, and what it put there itself: a task's
// notification, a message from another session, a note about a command.
let prompt = (body: string, human: boolean): Comps[] =>
  human
    ? said(typedAs(body))
    : said(body, claudeStops.includes(body) ? { stop: {} } : { notice: {} })

let human = (e: Event) => obj(e.origin).kind == 'human'

let assistant = (b: Event): Comps[] =>
  b.type == 'text'
    ? said(str(b.text), { output: {} })
    : b.type == 'thinking'
    ? said(str(b.thinking), { reasoning: {}, output: {} })
    : b.type == 'tool_use'
    ? [call(str(b.name), b.id, b.input)]
    : []

let user = (b: Event, typed: boolean): Comps[] =>
  b.type == 'text'
    ? prompt(str(b.text), typed)
    : b.type == 'tool_result'
    ? [result(b.tool_use_id, text(b.content), !!b.is_error)]
    : []

let blocks = (e: Event): Event[] => {
  let c = obj(e.message).content
  return typeof c == 'string' ? [{ type: 'text', text: c }] : list(c)
}

// One line of Claude Code's, whichever conversation it belongs to.
let line: Reader = (e) => {
  let at = str(e.timestamp) || undefined
  let a = obj(e.attachment)
  let entries: Comps[] = e.type == 'user' && e.isCompactSummary
    ? said(text(obj(e.message).content), { checkpoint: {}, notice: {} })
    // An answer Claude Code wrote itself for a refused call (its `error`:
    // `rate_limit` for a plan limit, `billing_error`, ...) is a refusal, its
    // text the reason.
    : e.type == 'assistant' && str(e.error)
    ? [{
      refusal: { code: str(e.error) },
      content: { body: text(obj(e.message).content) },
      output: {},
    }]
    : e.type == 'assistant'
    ? [...blocks(e).flatMap(assistant), ...requested(e)]
    : e.type == 'user'
    ? blocks(e).flatMap((b) => user(b, human(e)))
    // A message typed while a turn runs reaches the model as this attachment.
    : e.type == 'attachment' && a.type == 'queued_command'
    ? prompt(text(a.prompt), human(a))
    // A result closes a turn, not the run: a run with background tasks takes
    // another turn when one finishes. Its process exiting is the run's end
    // (@yaks/spawn `ended`). Only a failed turn says something: Claude reports
    // an API refusal as subtype `success` with is_error set, and the result
    // text holds the diagnosis.
    : e.type == 'result' && e.is_error
    ? [{
      refusal: { code: String(e.subtype ?? 'error') },
      // A turn that failed before it began (a resume that finds no
      // conversation) has no result text; its reason is in `errors`.
      content: {
        body: String(
          e.result || (Array.isArray(e.errors) && e.errors.join('; ')) ||
            'the turn failed',
        ),
      },
      output: {},
    }]
    : []
  let about = e.type == 'system' && e.subtype == 'init' && e.session_id
    ? { session: { id: String(e.session_id) } }
    : undefined
  let model = e.type == 'system' && e.subtype == 'init' && e.model
    ? String(e.model)
    : undefined
  let fixed = fixedOf(e)
  let limits = e.type == 'rate_limit_event'
    ? metered(obj(e.rate_limit_info))
    : []
  return {
    entries,
    ...(about ? { about } : {}),
    ...(at ? { at } : {}),
    ...(fixed.length ? { fixed } : {}),
    ...(limits.length ? { limits } : {}),
    ...(model ? { model } : {}),
  }
}

/**
 * Claude Code: the transcript it keeps of an interactive session
 * (`~/.claude/projects/<project>/<session>.jsonl`), and the stream
 * `claude -p --output-format stream-json` prints. The two share their message
 * lines; the file adds the queue and the harness's own notes, and the stream
 * adds the line that opens a run and the one that closes each turn. A side
 * conversation, which older files keep inline and the stream marks with the
 * call that started it, is a subagent's, read from its own transcript, not
 * this session's. The stream also says how much of the plan's limits is used
 * (`rate_limit_event`), whenever a window's percentage moves; an interactive
 * session's file does not, and its status line is read instead
 * (@yaks/spend). A line written from the graph to open a session in Claude
 * Code names the entry it came from (`yak.entry`, ./resume.ts) and is read as
 * nothing: it is that entry already.
 *
 * ```ts
 * import { claude } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let typed = { type: 'user', origin: { kind: 'human' }, message: { content: 'hi' } }
 * assertEquals(claude(typed).entries, [{ content: { body: 'hi' } }])
 * let aside = { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: 'done' } }
 * assertEquals(claude(aside).entries, [])
 * let ours = { ...typed, yak: { entry: 'e' } }
 * assertEquals(claude(ours).entries, [])
 * let week = { utilization: 0.25, resetsAt: 1794913200, status: 'allowed' }
 * let metered = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { seven_day: week } } }
 * assertEquals(claude(metered).limits, [
 *   { provider: 'claude', window: 10080, used: 25, resets: '2026-11-17T11:00:00.000Z' },
 * ])
 * ```
 */
export let claude: Reader = (e) =>
  e.isSidechain || e.parent_tool_use_id || e.yak ? nothing : line(e)

/**
 * A Claude Code subagent's own transcript
 * (`<project>/<session>/subagents/agent-<id>.jsonl`), every line of which is
 * a side conversation of the session that started it.
 *
 * ```ts
 * import { subagent } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let said = { type: 'assistant', isSidechain: true, message: { content: 'done' } }
 * assertEquals(subagent(said).entries, [{ content: { body: 'done' }, output: {} }])
 * ```
 */
export let subagent: Reader = line

// What a codex tool item called and what it answered. An MCP call is named the
// way Claude Code names one; every other item is named by its type.
let tool = (it: Event): string =>
  it.type == 'mcp_tool_call'
    ? `mcp__${str(it.server)}__${str(it.tool)}`
    : str(it.type)

let asked = (it: Event): unknown => {
  if (it.type == 'mcp_tool_call') return it.arguments
  let {
    id: _id,
    type: _type,
    status: _status,
    aggregated_output: _out,
    exit_code: _code,
    result: _result,
    error: _error,
    ...args
  } = it
  return args
}

let answered = (it: Event): string =>
  str(it.aggregated_output) || text(obj(it.result).content) ||
  str(obj(it.error).message) || str(it.status)

let failed = (it: Event) =>
  it.status == 'failed' || (it.exit_code != null && it.exit_code != 0)

let spoken = (it: Event): Comps[] | undefined =>
  it.type == 'agent_message'
    ? said(str(it.text), { output: {} })
    : it.type == 'reasoning'
    ? said(str(it.text), { reasoning: {}, output: {} })
    : undefined

// Why a Codex turn failed. Its event carries only a message, and the one its
// content filter writes ("This content was flagged for possible cybersecurity
// risk", "your prompt was flagged as potentially violating our usage policy")
// is the provider declining the request, `content_policy`.
let turnFailed = (message: string): string =>
  /\bflagged\b/i.test(message) ? 'content_policy' : 'turn.failed'

/**
 * Codex: the stream `codex exec --json` prints.
 *
 * ```ts
 * import { codex } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let done = { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }
 * assertEquals(codex(done).entries, [{ content: { body: 'hi' }, output: {} }])
 * ```
 */
export let codex: Reader = (e) => {
  let it = obj(e.item)
  let entries: Comps[] = e.type == 'item.started'
    ? spoken(it) ? [] : [call(tool(it), it.id, asked(it))]
    : e.type == 'item.completed'
    // An item that never said it started is a call and its answer at once.
    ? spoken(it) ?? [
      call(tool(it), it.id, asked(it)),
      result(it.id, answered(it), failed(it)),
    ]
    : e.type == 'turn.completed'
    ? [{ stop: {}, ...codexUsage(e.usage) }]
    : e.type == 'turn.failed'
    ? [{
      refusal: { code: turnFailed(str(obj(e.error).message)) },
      content: { body: str(obj(e.error).message) || 'the turn failed' },
      output: {},
      stop: {},
    }]
    : []
  return e.type == 'thread.started' && e.thread_id
    ? { entries, about: { session: { id: String(e.thread_id) } } }
    : { entries }
}

// Text, given as a string or as its UTF-8 bytes.
let utf8 = (v: unknown): string | undefined =>
  typeof v == 'string'
    ? v
    : Array.isArray(v) && v.every(Number.isInteger)
    ? new TextDecoder().decode(Uint8Array.from(v))
    : undefined

// What a Grok Build tool's result showed the model: its stream answers a call
// with the tool's own result as JSON, its output in bytes, a shell call's
// beside `output_for_prompt`, the text the model read, and a search's as
// `stdout`.
let prompted = (b: Event): Event => {
  if (b.type != 'tool_result' || typeof b.content != 'string') return b
  let r: Event
  try {
    r = obj(JSON.parse(b.content))
  } catch {
    return b
  }
  let shown = utf8(r.output_for_prompt) ?? utf8(r.stdout)
  return shown == null ? b : { ...b, content: shown }
}

/**
 * Grok Build's stream, `grok -p --output-format streaming-messages-json`:
 * Claude Code's stream-json, read as {@link claude} reads it, except that a
 * tool's result is the tool's own JSON. A shell call's and a search's are
 * read as the text the model was shown (`output_for_prompt`, `stdout`); its
 * history file (`grok`) keeps only that text.
 *
 * ```ts
 * import { grokStream } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let ran = JSON.stringify({ type: 'Bash', output: [104, 105], output_for_prompt: 'exit: 0\nhi' })
 * let answer = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: ran }] } }
 * assertEquals(grokStream(answer).entries, [
 *   { result: { call: 'c1' }, content: { body: 'exit: 0\nhi' }, execution: {} },
 * ])
 * let found = JSON.stringify({ type: 'GrepSearch', stdout: [70, 111, 117, 110, 100] })
 * assertEquals(grokStream({ ...answer, message: { content: [{ type: 'tool_result', tool_use_id: 'c2', content: found }] } }).entries, [
 *   { result: { call: 'c2' }, content: { body: 'Found' }, execution: {} },
 * ])
 * ```
 */
export let grokStream: Reader = (e) => {
  let m = obj(e.message)
  return claude(
    e.type == 'user' && Array.isArray(m.content)
      ? { ...e, message: { ...m, content: m.content.map(prompted) } }
      : e,
  )
}

// Why a Google CLI's turn failed: its plan's limit, a quota or a rate limit
// spent ("You exceeded your current quota", RESOURCE_EXHAUSTED), is
// `rate_limit`, as Claude's is, so the run ends as one its plan declined and
// moves to an account with room (@yaks/spawn); anything else is an error.
let googleFailed = (message: string): Comps => ({
  refusal: {
    code: /\bquota\b|resource.?exhausted|exhausted your capacity|rate.?limit/i
        .test(message)
      ? 'rate_limit'
      : 'error',
  },
  content: { body: message },
  output: {},
})

// A turn's end, with what it used, and why it failed where it did.
let ended = (error: string, used: Comps): Comps[] => [
  ...error ? [googleFailed(error)] : [],
  { stop: {}, ...used },
]

// The model that read the conversation in Gemini CLI's `result.stats.models`:
// when a turn routes across models, the one with the most input tokens
// answered; the smaller one is Gemini's router.
let geminiModel = (models: Event): string | undefined =>
  Object.entries(models)
    .filter(([name]) => name)
    .map(([name, raw]) => [name, count(obj(raw).input_tokens) ?? -1] as const)
    .sort((a, b) => b[1] - a[1])[0]?.[0]

/**
 * Gemini CLI: the stream `gemini -p --output-format stream-json` prints. Its
 * reply comes in fragments (`message` with `delta`), each a part of the entry
 * the next tool call or the turn's end closes. The prompt it echoes is the
 * session's own request already, and is read as nothing.
 *
 * ```ts
 * import { gemini } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let piece = { type: 'message', role: 'assistant', content: 'Hel', delta: true }
 * assertEquals(gemini(piece).part, { key: 'reply', entry: { content: { body: 'Hel' }, output: {} } })
 * let used = { type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { file_path: 'a.ts' } }
 * assertEquals(gemini(used).entries, [{ call: { to: 'read_file', id: 't1', args: { file_path: 'a.ts' } } }])
 * let spent = { type: 'result', status: 'error', error: { message: 'You exceeded your current quota' } }
 * assertEquals(gemini(spent).entries[0].refusal, { code: 'rate_limit' })
 * ```
 */
export let gemini: Reader = (e) => {
  let type = str(e.type)
  let stats = obj(e.stats)
  let entries: Comps[] = type == 'tool_use'
    ? [call(str(e.tool_name), e.tool_id, e.parameters)]
    : type == 'tool_result'
    ? [result(
      e.tool_id,
      str(e.output) || str(obj(e.error).message),
      e.status == 'error',
    )]
    : type == 'error'
    ? e.severity == 'error'
      ? [googleFailed(str(e.message))]
      : said(str(e.message), { notice: {} })
    : type == 'result'
    ? ended(
      e.status == 'success'
        ? ''
        : str(obj(e.error).message) || 'the turn failed',
      usage(
        count(stats.input_tokens),
        count(stats.output_tokens),
        count(stats.cached),
      ),
    )
    : type == 'message' && e.role == 'assistant' && !e.delta
    ? said(str(e.content), { output: {} })
    : []
  let piece = type == 'message' && e.role == 'assistant' && e.delta &&
    str(e.content)
  let model = type == 'init'
    ? (str(e.model) == 'auto' ? '' : str(e.model))
    : type == 'result'
    ? geminiModel(obj(stats.models))
    : undefined
  return {
    entries,
    ...piece
      ? {
        part: { key: 'reply', entry: { content: { body: piece }, output: {} } },
      }
      : {},
    ...type == 'init' && e.session_id
      ? { about: { session: { id: str(e.session_id) } } }
      : {},
    ...model ? { model } : {},
    ...str(e.timestamp) ? { at: str(e.timestamp) } : {},
  }
}

/**
 * Antigravity CLI: the stream `agy --print --output-format stream-json`
 * prints (antigravity.google/docs/cli/headless), an `init`, then a
 * `step_update` per step as it runs and finishes, then the `result`. What
 * the model says arrives as `text_delta` fragments of its `agent_response`
 * step, each a part of that step's entry; a `tool` step finished carries
 * its call and what it answered (`tool_info`). The result repeats the last
 * reply whole (`response`), which its parts already said.
 *
 * ```ts
 * import { antigravityStream } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let ran = { event: 'step_update', step_update: { step_index: 4, state: 'DONE', step_type: 'tool',
 *   tool_info: { name: 'run_command', parameters: { CommandLine: 'ls' }, output: 'a.ts' } } }
 * assertEquals(antigravityStream(ran).entries.map((c) => c.call ?? c.result), [
 *   { to: 'run_command', id: 'step-4', args: { CommandLine: 'ls' } },
 *   { call: 'step-4' },
 * ])
 * ```
 */
export let antigravityStream: Reader = (e) => {
  let event = str(e.event)
  let s = obj(e.step_update)
  let info = obj(s.tool_info)
  let id = stepCall(Number(s.step_index))
  let r = obj(e.result)
  let u = obj(r.usage)
  let entries: Comps[] = event == 'step_update' && s.step_type == 'tool' &&
      Object.keys(info).length
    ? [
      call(str(info.name) || str(s.tool_name), id, info.parameters),
      ...s.state == 'DONE'
        ? [result(
          id,
          str(info.output) || str(obj(info.error).message),
          !!info.error,
        )]
        : [],
    ]
    : event == 'result'
    ? ended(
      r.status == 'SUCCESS' ? '' : str(r.error) || 'the turn failed',
      // Its `input_tokens` leaves out the cached ones, which `usage` counts.
      usage(
        u.input_tokens == null
          ? undefined
          : (count(u.input_tokens) ?? 0) + (count(u.cache_read_tokens) ?? 0),
        count(u.output_tokens),
        count(u.cache_read_tokens),
        { reasoning_tokens: count(u.thinking_tokens) },
      ),
    )
    : []
  let piece = event == 'step_update' && s.step_type == 'agent_response' &&
    str(s.text_delta)
  let init = obj(e.init)
  return {
    entries,
    ...piece
      ? { part: { key: id, entry: { content: { body: piece }, output: {} } } }
      : {},
    ...event == 'init' && e.conversation_id
      ? { about: { session: { id: str(e.conversation_id) } } }
      : {},
    ...str(init.model) ? { model: str(init.model) } : {},
  }
}

/** The readers this package ships for the stream each harness prints when
 * a run is managed (@yaks/spawn), by the harness's name. */
export let readers: Record<string, Reader> = {
  claude,
  codex,
  grok: grokStream,
  gemini,
  antigravity: antigravityStream,
}

// Codex rollouts repeat their visible messages in event_msg notifications.
// Read response_item once; event_msg only supplies turn boundaries and usage.
let rolloutText = (v: unknown): string =>
  typeof v == 'string' ? v : list(v)
    .filter((b) =>
      ['text', 'input_text', 'output_text', 'summary_text'].includes(
        str(b.type),
      )
    )
    .map((b) => str(b.text)).join('\n')

let argumentsOf = (raw: unknown): Event => {
  if (typeof raw != 'string') return obj(raw)
  try {
    return obj(JSON.parse(raw))
  } catch {
    return { input: raw }
  }
}

let rolloutInput = (it: Event): Comps[] => {
  let kinds =
    obj(it.internal_chat_message_metadata_passthrough).content_item_kinds
  let blocks = list(it.content)
  return blocks.flatMap((b, i) => {
    let body = rolloutText([b])
    let kind = Array.isArray(kinds) ? str(kinds[i]) : ''
    let typed = it.role == 'user' &&
      (kind
        ? kind.startsWith('user.')
        : !/^(?:# AGENTS\.md|<environment_context>|<INSTRUCTIONS>)/.test(body))
    return said(body, typed ? {} : { notice: {} })
  })
}

let rolloutItem = (it: Event): Comps[] =>
  it.type == 'message'
    ? it.role == 'assistant'
      ? said(rolloutText(it.content), { output: {} })
      : rolloutInput(it)
    : it.type == 'agent_message'
    ? said(rolloutText(it.content), { notice: {} })
    : it.type == 'reasoning'
    ? said(rolloutText(it.summary), { reasoning: {}, output: {} })
    : it.type == 'function_call' || it.type == 'custom_tool_call'
    ? [
      call(
        [str(it.namespace), str(it.name)].filter(Boolean).join('.'),
        it.call_id,
        it.type == 'custom_tool_call'
          ? { input: it.input }
          : argumentsOf(it.arguments),
      ),
    ]
    : it.type == 'function_call_output' || it.type == 'custom_tool_call_output'
    ? [result(it.call_id, rolloutText(it.output), false)]
    : []

/** Codex's on-disk rollout format. Read messages from response_item so the
 * event_msg mirrors never duplicate them. A using names the CLI runner and
 * model; the importer resolves those names into graph identities. */
export let codexRollout: Reader = (e) => {
  let it = obj(e.payload)
  let entries = e.type == 'response_item'
    ? rolloutItem(it)
    : e.type == 'session_meta'
    ? [{ using: { provider: 'codex' }, notice: {} }]
    : e.type == 'turn_context' && it.model
    ? [{
      using: {
        provider: 'codex',
        model: str(it.model),
        ...(it.effort ? { effort: str(it.effort) } : {}),
      },
      notice: {},
    }]
    : e.type == 'event_msg' && it.type == 'task_complete'
    ? [{ stop: {} }]
    : e.type == 'event_msg' && it.type == 'turn_aborted'
    ? [{ stop: {} }]
    : e.type == 'token_usage_record'
    ? Object.keys(codexUsage(it.usage)).length
      ? [{
        ask: { id: str(it.response_id) || str(it.turn_id) },
        ...codexUsage(it.usage),
      }]
      : []
    : e.type == 'compacted'
    ? said(str(it.message), { checkpoint: {}, notice: {} })
    : []
  let system = str(obj(it.base_instructions).text)
  let limits = e.type == 'event_msg' && it.type == 'token_count'
    ? limited(obj(it.rate_limits))
    : []
  return {
    entries,
    ...(str(e.timestamp) ? { at: str(e.timestamp) } : {}),
    ...(e.type == 'session_meta' && system
      ? { fixed: [{ source: 'system', parts: [['system', system.length]] }] }
      : {}),
    ...(limits.length ? { limits } : {}),
  }
}

// Codex's plan limits, as a token count reports them: a primary window and
// perhaps a secondary one, each a percentage used and when it resets.
let limited = (r: Event): Limit[] =>
  [obj(r.primary), obj(r.secondary)].flatMap((w) =>
    w.window_minutes == null || count(w.used_percent) == null ? [] : [{
      provider: 'codex',
      window: Number(w.window_minutes),
      used: Number(w.used_percent),
      ...count(w.resets_at) == null
        ? {}
        : { resets: new Date(Number(w.resets_at) * 1000).toISOString() },
    }]
  )

// Readable text out of a row's content: a string, or blocks each carrying its
// text, whatever the block's type is called.
let prose = (v: unknown): string =>
  typeof v == 'string'
    ? v
    : list(v).map((b) => str(b.text)).filter(Boolean).join('\n')

/**
 * Grok Build: the model's history it keeps of a session,
 * `$GROK_HOME/sessions/<percent-encoded cwd>/<session>/chat_history.jsonl`,
 * one `{type, content}` row per line. An assistant row names its model
 * (`model_id`) and the calls it made (`tool_calls`: `{id, name, arguments}`,
 * the arguments a JSON string), and a `tool_result` names the call it answers
 * (`tool_call_id`). Reasoning that is only `encrypted_content` says nothing
 * readable, and the rows carry no time. The session's `updates.jsonl` streams
 * the same turns as Agent Client Protocol chunks; the history holds each
 * message whole.
 *
 * ```ts
 * import { grok } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let asked = { type: 'assistant', content: 'Looking.', model_id: 'grok-4.6-build',
 *   tool_calls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}' }] }
 * assertEquals(grok(asked).entries, [
 *   { content: { body: 'Looking.' }, output: {} },
 *   { call: { to: 'read_file', id: 'c1', args: { path: 'a.ts' } } },
 * ])
 * assertEquals(grok(asked).model, 'grok-4.6-build')
 * ```
 */
export let grok: Reader = (e) => {
  let type = str(e.type)
  let body = prose(e.content)
  let entries: Comps[] = type == 'system'
    ? [{ using: { provider: 'grok' }, notice: {} }]
    : type == 'user'
    ? said(body)
    : type == 'assistant'
    ? [
      ...said(body, { output: {} }),
      ...list(e.tool_calls).map((c) =>
        call(str(c.name), c.id, argumentsOf(c.arguments))
      ),
    ]
    : type == 'reasoning'
    ? said(body, { reasoning: {}, output: {} })
    : type == 'tool_result'
    ? [result(e.tool_call_id, body, !!e.is_error)]
    // A call the backend ran itself (its web search) is asked and answered
    // on one row.
    : type == 'backend_tool_call'
    ? [
      call(str(e.name) || 'backend_tool', e.id, argumentsOf(e.arguments)),
      result(e.id, body, false),
    ]
    : type == 'compaction_checkpoint'
    ? said(body, { checkpoint: {}, notice: {} })
    : []
  return {
    entries,
    ...(type == 'system' && body
      ? { fixed: [{ source: 'system', parts: [['system', body.length]] }] }
      : {}),
    ...(type == 'assistant' && str(e.model_id)
      ? { model: str(e.model_id) }
      : {}),
  }
}

// The call an Antigravity step's result answers: a planner response's calls
// are answered in order by the steps after it, one each, so the `k`th call of
// step `s` is answered at step `s + 1 + k`, and both name it by that step.
let stepCall = (step: number) => `step-${step}`

/**
 * Antigravity CLI (`agy`): the steps of a conversation,
 * `~/.gemini/antigravity-cli/brain/<conversation>/.system_generated/logs/transcript_full.jsonl`,
 * one `{step_index, source, type, status, created_at, content}` per line. A
 * `PLANNER_RESPONSE` carries what the model said, its `thinking` and the
 * calls it made (`tool_calls`: `{name, args}`, with no id), and each call's
 * outcome is the `GENERIC` step after it, in the order of the calls, its
 * `status` `DONE`, `ERROR`, `INVALID` or `RUNNING`. A call is named by the
 * step that answers it, and that step names its call too, so a call whose
 * planner line was never read still has the call its result answers.
 *
 * ```ts
 * import { antigravity } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let planned = { step_index: 3, type: 'PLANNER_RESPONSE', content: 'Reading it.',
 *   tool_calls: [{ name: 'view_file', args: { AbsolutePath: '/w/a.ts' } }] }
 * assertEquals(antigravity(planned).entries, [
 *   { content: { body: 'Reading it.' }, output: {} },
 *   { call: { to: 'view_file', id: 'step-4', args: { AbsolutePath: '/w/a.ts' } } },
 * ])
 * let done = { step_index: 4, type: 'GENERIC', status: 'DONE', content: 'export {}' }
 * assertEquals(antigravity(done).entries[1].result, { call: 'step-4' })
 * ```
 */
export let antigravity: Reader = (e) => {
  let type = str(e.type)
  let step = Number(e.step_index)
  let body = prose(e.content)
  let entries: Comps[] = type == 'USER_INPUT'
    ? said(body, e.source == 'USER_EXPLICIT' || !e.source ? {} : { notice: {} })
    : type == 'PLANNER_RESPONSE'
    ? [
      ...said(prose(e.thinking), { reasoning: {}, output: {} }),
      ...said(body, { output: {} }),
      ...list(e.tool_calls).map((c, k) =>
        call(str(c.name), stepCall(step + 1 + k), argumentsOf(c.args))
      ),
    ]
    : type == 'GENERIC' && e.status != 'RUNNING'
    ? [
      { call: { id: stepCall(step) } },
      result(
        stepCall(step),
        body,
        e.status == 'ERROR' || e.status == 'INVALID',
      ),
    ]
    : type == 'SYSTEM_MESSAGE' || type == 'CONVERSATION_HISTORY'
    ? said(body, { notice: {} })
    : type == 'CHECKPOINT'
    ? said(body, { checkpoint: {}, notice: {} })
    : type == 'ERROR_MESSAGE'
    ? [{
      refusal: { code: 'error' },
      content: { body: body || 'the step failed' },
      output: {},
    }]
    : []
  return {
    entries: step == 0
      ? [{ using: { provider: 'antigravity' }, notice: {} }, ...entries]
      : entries,
    ...(str(e.created_at) ? { at: str(e.created_at) } : {}),
  }
}
