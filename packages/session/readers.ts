// What a harness's log says, one line at a time. Claude Code and Codex each
// write one JSON object per line, to a transcript file of their own and to
// stdout when a managed run is read (@yaks/spawn), and a reader turns one line
// into the entries it becomes: what a person typed, what the harness put in
// front of the model, what the model said and thought, and the tool calls the
// harness ran with what they returned. Code, and only code: which file belongs
// to which session, and what the graph makes of an entry, is the importer's
// (./tail.ts).
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
//   stop, usage, error       the end of a managed turn, and what it cost
//
// A tool's arguments and output pass through `scrub()`, since a command's
// output is where a credential turns up. A person's words and the model's are
// kept verbatim.
//
// The event shapes are copied from live runs of both CLIs and from the files
// they keep, not from their docs.

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
}

/** A harness's line format. */
export type Reader = (e: Event) => Said

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
 * ```
 */
export let scrub = (s: string): string =>
  s
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
  execution: { state: failed ? 'failed' : 'done' },
})

// A count a harness reported, or nothing. Absent beats zero: a tier a vendor
// never reports must not fold to 0, or a sum cannot tell the two apart.
let count = (v: unknown): number | undefined => {
  if (v == null) return undefined
  let n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

let put = (k: string, v?: number) => v == null ? {} : { [k]: v }

// @yaks/model's `usage`, from the two shapes the two vendors report. Claude
// reports cache reads separately; codex counts them inside `input_tokens`, and
// that is the vendor's own arithmetic, kept rather than corrected.
let usage = (raw: unknown, cached: string): Comps => {
  let u = obj(raw)
  let told = {
    ...put('input_tokens', count(u.input_tokens)),
    ...put('output_tokens', count(u.output_tokens)),
    ...put('cached_tokens', count(u[cached])),
  }
  return Object.keys(told).length ? { usage: told } : {}
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
  human ? said(typedAs(body)) : said(body, { notice: {} })

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

/**
 * Claude Code: the transcript it keeps of an interactive session
 * (`~/.claude/projects/<project>/<session>.jsonl`), and the stream
 * `claude -p --output-format stream-json` prints. The two share their message
 * lines; the file adds the queue and the harness's own notes, and the stream
 * adds the line that opens a run and the one that ends it.
 *
 * ```ts
 * import { claude } from '@yaks/session'
 * import { assertEquals } from '@std/assert'
 *
 * let typed = { type: 'user', origin: { kind: 'human' }, message: { content: 'hi' } }
 * assertEquals(claude(typed).entries, [{ content: { body: 'hi' } }])
 * ```
 */
export let claude: Reader = (e) => {
  // A side conversation (a subagent's, in older files) is not this session's.
  if (e.isSidechain) return nothing
  let at = str(e.timestamp) || undefined
  let a = obj(e.attachment)
  let entries: Comps[] = e.type == 'assistant'
    ? blocks(e).flatMap(assistant)
    : e.type == 'user'
    ? blocks(e).flatMap((b) => user(b, human(e)))
    // A message typed while a turn runs reaches the model as this attachment.
    : e.type == 'attachment' && a.type == 'queued_command'
    ? prompt(text(a.prompt), human(a))
    : e.type == 'result'
    // The run is over either way; what differs is whether it ended well.
    // Claude reports an API refusal as subtype `success` with is_error set,
    // and the result text holds the diagnosis.
    ? [{
      ...(e.is_error
        ? {
          error: { code: String(e.subtype ?? 'error') },
          content: { body: String(e.result ?? 'the turn failed') },
          output: {},
        }
        : {}),
      stop: {},
      ...usage(e.usage, 'cache_read_input_tokens'),
    }]
    : []
  let about = e.type == 'system' && e.subtype == 'init' && e.session_id
    ? { session: { id: String(e.session_id) } }
    : undefined
  return { entries, ...(about ? { about } : {}), ...(at ? { at } : {}) }
}

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
    ? [{ stop: {}, ...usage(e.usage, 'cached_input_tokens') }]
    : e.type == 'turn.failed'
    ? [{
      error: { code: 'turn.failed' },
      content: { body: str(obj(e.error).message) || 'the turn failed' },
      output: {},
      stop: {},
    }]
    : []
  return e.type == 'thread.started' && e.thread_id
    ? { entries, about: { session: { id: String(e.thread_id) } } }
    : { entries }
}

/** The readers this package ships, by the harness's name. */
export let readers: Record<string, Reader> = { claude, codex }
