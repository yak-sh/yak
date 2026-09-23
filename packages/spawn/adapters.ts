// What a managed session runs, and how to read back what it prints. An adapter
// is a provider's argv plus the function that converts one line of its
// JSON-lines output into the components of one transcript entry — code, and
// only code. Which providers exist and which models each one serves is graph
// data (@yaks/model's `provider` and `model` entities), so adding a model means
// inserting a row, not cutting a release.
//
// Every provider prints one JSON object per event, so ./run.ts never learns a
// vendor's format: it asks the adapter what a line means and appends whatever
// comes back. A line no adapter recognizes is left alone — the file is still
// the durable log, and the graph stores the transcript rather than the raw
// stream.
//
// Adapters deliberately never produce `call` and `result` components. The
// provider already ran its own tool calls, in its own process. Written into the
// graph as a `call` row, the server's tool runner (@yaks/tools) would execute
// any call naming a tool it has, running them a second time. No component yet
// means "another process already ran this", so tool calls stay in the log file.
//
// The event shapes are copied from live runs of both CLIs rather than from
// their docs.

/** One parsed line of a provider's stream. */
export type Event = Record<string, unknown>

/** The components of one entry, as an adapter reports them. No eids: an
 * adapter knows a provider's output format and nothing about the graph its
 * output is read into. */
export type Comps = Record<string, Record<string, unknown>>

/** What a run was asked for; the command line is built from it. */
export type Job = {
  /** the session entity — the transcript this run writes, and the id the
   * provider is asked to give its own thread */
  session: string
  /** the model, by the name its provider knows it by */
  model?: string
  /** how hard to think, where the provider accepts such a setting */
  effort?: string
  /** what it was asked to do */
  instruction: string
}

/** A provider that is run as a command. */
export type Adapter = {
  /** the command line to run it with, the program name first */
  argv: (job: Job) => string[]
  /** what this line means, as the components the entry it becomes carries;
   * null when the line does not become an entry */
  entry: (e: Event) => Comps | null
  /** what this line means for the session row itself — the provider's own id
   * for the thread, and nothing else so far */
  about?: (e: Event) => Comps | null
}

// A count a provider reported, or nothing. Absent beats zero: a tier a vendor
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
let anthropicUsage = (raw: unknown): Comps['usage'] | null => {
  if (!raw || typeof raw != 'object') return null
  let u = raw as Record<string, unknown>
  let said = {
    ...put('input_tokens', count(u.input_tokens)),
    ...put('output_tokens', count(u.output_tokens)),
    ...put('cached_tokens', count(u.cache_read_input_tokens)),
  }
  return Object.keys(said).length ? said : null
}

let codexUsage = (raw: unknown): Comps['usage'] | null => {
  if (!raw || typeof raw != 'object') return null
  let u = raw as Record<string, unknown>
  let said = {
    ...put('input_tokens', count(u.input_tokens)),
    ...put('output_tokens', count(u.output_tokens)),
    ...put('cached_tokens', count(u.cached_input_tokens)),
  }
  return Object.keys(said).length ? said : null
}

// A claude content block, as much of it as the reader reads.
type Block = { type?: string; text?: unknown; thinking?: unknown }

let blocks = (e: Event): Block[] => {
  let message = e.message as { content?: unknown } | undefined
  let said = message?.content
  if (typeof said == 'string') return [{ type: 'text', text: said }]
  return (Array.isArray(said) ? said : []) as Block[]
}

/** `claude -p --output-format stream-json`. */
export let claude: Adapter = {
  argv: (j) => [
    'claude',
    '-p',
    '--session-id',
    j.session,
    '--output-format',
    'stream-json',
    '--verbose', // stream-json in print mode requires it
    ...(j.model ? ['--model', j.model] : []),
    '--permission-mode',
    'bypassPermissions', // it owns its worktree; nobody is at the prompt
    // -- ends the options: the instruction is a positional, so content that
    // opens with a dash parses as content and not as an unknown flag.
    '--',
    j.instruction,
  ],
  about: (e) =>
    e.type == 'system' && e.subtype == 'init' && e.session_id
      ? { session: { id: String(e.session_id) } }
      : null,
  entry: (e): Comps | null => {
    if (e.type == 'assistant') {
      let said = blocks(e)
      let text = said.filter((b) => b.type == 'text')
        .map((b) => String(b.text ?? '')).join('\n')
      if (text) return { content: { body: text } }
      let thought = said.find((b) => b.type == 'thinking')
      let body = String(thought?.thinking ?? '')
      return body ? { content: { body }, reasoning: {} } : null
    }
    if (e.type != 'result') return null
    // The turn is over either way; what differs is whether it ended well.
    // Claude reports an API refusal as subtype `success` with is_error set,
    // and the result text holds the diagnosis.
    let usage = anthropicUsage(e.usage)
    if (e.is_error) {
      return {
        error: { code: String(e.subtype ?? 'error') },
        content: { body: String(e.result ?? 'the turn failed') },
        stop: {},
        ...(usage ? { usage } : {}),
      }
    }
    return { stop: {}, ...(usage ? { usage } : {}) }
  },
}

// A codex item, as much of it as the reader reads.
type Item = { type?: string; text?: unknown }

/** `codex exec --json`. */
export let codex: Adapter = {
  argv: (j) => [
    'codex',
    'exec',
    '--json',
    // No approvals and no sandbox: a headless exec has nobody to approve, and
    // the run's worktree is its blast radius (the fleet's posture, 2026-07-17).
    '--dangerously-bypass-approvals-and-sandbox',
    ...(j.model ? ['-m', j.model] : []),
    ...(j.effort ? ['-c', `model_reasoning_effort=${j.effort}`] : []),
    '--',
    j.instruction,
  ],
  about: (e) =>
    e.type == 'thread.started' && e.thread_id
      ? { session: { id: String(e.thread_id) } }
      : null,
  entry: (e): Comps | null => {
    if (e.type == 'item.completed') {
      let it = (e as { item?: Item }).item
      let body = String(it?.text ?? '')
      if (!body) return null
      if (it?.type == 'agent_message') return { content: { body } }
      if (it?.type == 'reasoning') return { content: { body }, reasoning: {} }
      return null
    }
    if (e.type == 'turn.completed') {
      let usage = codexUsage(e.usage)
      return { stop: {}, ...(usage ? { usage } : {}) }
    }
    if (e.type == 'turn.failed') {
      let said = (e as { error?: { message?: unknown } }).error?.message
      return {
        error: { code: 'turn.failed' },
        content: { body: String(said ?? 'the turn failed') },
        stop: {},
      }
    }
    return null
  },
}

/**
 * The providers run as commands, keyed by the `name` on their `provider`
 * entity. A server with a provider of its own builds its own table
 * ({@link https://jsr.io/@yaks/spawn/doc/effects/~/spawning | spawning}). A
 * provider missing from this table is one this package does not launch, which
 * is how an `http` provider is left to the in-process daemon.
 */
export let adapters: Record<string, Adapter> = { claude, codex }
