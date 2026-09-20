// The provider seam: what a managed session RUNS, and how to read back what it
// prints. An adapter is its argv and the reader that turns one line of its
// JSONL into the comps one transcript entry wears — code, and only code. WHICH
// providers exist and which models each serves is graph data (@yaks/model's
// `provider` and `model` entities), so adding a model is a write, not a
// release.
//
// Every provider prints one JSON object per event, so ./run.ts never learns a
// vendor's dialect: it asks the adapter what a line says and appends whatever
// comes back. A line no adapter recognizes is left where it is — the file is
// still the durable log, and the graph carries the transcript rather than the
// stream.
//
// What an adapter deliberately does NOT say is `call` and `result`. A
// provider's tool use already happened, in its own process; written as a
// `call` row it would be handed to THIS host's runner, which runs any call
// naming a tool it has (@yaks/tools) — and the tools a fleet agent reaches are
// exactly this host's. The word for "somebody else already ran this" is not in
// the vocabulary yet, so a tool use stays in the file.
//
// Event shapes are the fleet's, copied from live probes of both CLIs rather
// than from docs (src/adapters.ts).

/** One parsed line of a provider's stream. */
export type Event = Record<string, unknown>

/** The comps one entry wears, as an adapter states them: no eids, because an
 * adapter knows a dialect and never the graph it is read into. */
export type Comps = Record<string, Record<string, unknown>>

/** What a run was asked for, as a command line is built from it. */
export type Job = {
  /** the session entity — the transcript this run writes, and the name the
   * provider is asked to give its own thread */
  session: string
  /** the model, by the name its provider knows it by */
  model?: string
  /** how hard to think, where the provider takes such a word */
  effort?: string
  /** what it was asked to do */
  instruction: string
}

/** A provider that is a command. */
export type Adapter = {
  /** the command line to run it with, argv[0] first */
  argv: (job: Job) => string[]
  /** what this line says, as the comps the entry it becomes wears; null when
   * the line is not worth an entry */
  entry: (e: Event) => Comps | null
  /** what this line says about the SESSION row itself — the provider's own
   * name for the thread, and nothing else so far */
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
// splits cache reads out already; codex counts them inside `input_tokens`, and
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
    // and the result text carries the diagnosis.
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
 * The providers that are commands, by the name their `provider` entity wears.
 * A host with one of its own composes its own table
 * ({@link https://jsr.io/@yaks/spawn/doc/effects/~/spawning | spawning}); a
 * provider missing from it is one this package does not run, which is how an
 * `http` provider stays the in-process daemon's.
 */
export let adapters: Record<string, Adapter> = { claude, codex }
