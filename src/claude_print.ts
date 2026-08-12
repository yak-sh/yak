// The bounded `claude -p` generation transport — the Claude sibling of
// responses.ts behind the managed scheduler (D-16810, T-16814). One leased
// generation launches one foreground `claude -p --output-format stream-json`
// child in the Session worktree, reads the line-delimited stream, and turns the
// completed facts into a GenerationWork the scheduler appends. This file owns
// the process transport and the strict stream parser only: leases, worktrees,
// graph writes, continuity/resume (T-16816), and routing (T-16817) live
// elsewhere, and the full typed event→EntrySpec mapping is T-16815's.
//
// Claude Code runs its OWN built-in tools INSIDE the subprocess (T-16812): a
// tool_use and its tool_result arrive as two separate stream lines, already
// executed. So the transport records them as inert `opaque` evidence carrying
// their correlation key and returns NO `call` facet and an empty `calls` list —
// the generic ready-call SQL (entries.ts readySql) keys on a `call` component
// with no `result`, so with none produced it can never re-run a tool Claude
// already ran. T-16815 promotes these opaque pairs to typed call+result facets;
// until then the pair is durable, atomic (one work.specs append), and unrunnable.
//
// Secrets: `claude` reads subscription auth from HOME; Tasks never passes a
// credential in argv or env. But a stream/stderr/error line can still ECHO one,
// so every string that leaves this transport is scrubbed for credential markers,
// and an auth failure normalizes to a short known string, never the raw line.
import { childEnv } from './agent_env.ts'
import { type EntrySpec, type UsageValue } from './entries.ts'
import { type ObservationDelta } from './observations.ts'
import {
  type EntryRow,
  type GenerationContext,
  type GenerationRunner,
  type GenerationWork,
} from './runner.ts'

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let json = (value: unknown) => JSON.stringify(value)

// --- scrub ---------------------------------------------------------------
// Redact by credential MARKER, never by shape: a Claude thinking `signature`
// is a long opaque replay token we must KEEP (T-16815 wants it as
// opaque(anthropic:…)), so a blunt length-based redactor would eat exactly the
// evidence we mean to preserve. These patterns match real credentials —
// `sk-ant-…` / `sk-…` keys, a Bearer token, an `api_key: …` assignment — and
// leave everything else whole.
let markers: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{6,}/g, 'sk-ant-[redacted]'],
  [/\bsk-[A-Za-z0-9]{16,}/g, 'sk-[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]'],
  [
    /\b(api[_-]?key|token|secret|authorization|password|refresh[_-]?token|access[_-]?token)\b(\s*[:=]\s*)("?)[A-Za-z0-9._-]{8,}\3/gi,
    '$1$2[redacted]',
  ],
]

export let scrub = (text: string): string => {
  let out = text
  for (let [pattern, mask] of markers) out = out.replace(pattern, mask)
  return out
}

// Every string field of a parsed event is scrubbed before it is stored or
// broadcast, so no downstream reader (entry opaque data, observation deltas,
// the final text) can tunnel a credential that rode along in the stream.
let scrubDeep = (value: unknown): unknown => {
  if (typeof value == 'string') return scrub(value)
  if (Array.isArray(value)) return value.map(scrubDeep)
  if (!record(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, scrubDeep(item)]),
  )
}

// A terminal failure names WHY without leaking a raw line. Known auth and
// missing-thread failures collapse to a fixed short string; anything else is
// scrubbed and clipped so it stays a diagnosable-but-safe reason.
let known: [RegExp, string][] = [
  [
    /invalid.*api.*key|unauthorized|authentication|401\b|oauth|\/login\b/i,
    'authentication failed',
  ],
  [/no conversation found|session id/i, 'thread not found'],
  [/credit balance|billing|quota|payment/i, 'billing blocked'],
  [/rate.?limit|overloaded|429\b/i, 'rate limited'],
]

let reasonOf = (raw: string): string => {
  let text = raw.trim()
  if (!text) return ''
  for (let [pattern, label] of known) if (pattern.test(text)) return label
  let clean = scrub(text).replace(/\s+/g, ' ').trim()
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean
}

// --- stream vocabulary ---------------------------------------------------
export type ClaudeEvent = Record<string, unknown> & { type: string }

type Block = {
  type?: unknown
  text?: unknown
  thinking?: unknown
  signature?: unknown
  id?: unknown
  name?: unknown
  input?: unknown
  tool_use_id?: unknown
  is_error?: unknown
}

let blockOf = (event: ClaudeEvent): Block | undefined => {
  let message = event.message
  if (!record(message)) return undefined
  let content = message.content
  let first = Array.isArray(content) ? content[0] : content
  return record(first) ? first as Block : undefined
}

// The transient preview a connected watcher folds in memory (observations.ts);
// completed facts still take the durable spec path. One whole content block per
// assistant/user line, so a delta is the block's whole text, not a char run.
export let claudeObservation = (
  event: ClaudeEvent,
): ObservationDelta | undefined => {
  if (event.type != 'assistant') return undefined
  let block = blockOf(event)
  if (!block) return undefined
  if (block.type == 'text' && typeof block.text == 'string' && block.text) {
    return { kind: 'model', text: block.text }
  }
  if (
    block.type == 'thinking' && typeof block.thinking == 'string' &&
    block.thinking.trim()
  ) return { kind: 'reasoning', text: block.thinking }
  if (block.type == 'tool_use') {
    return {
      kind: 'tool',
      name: typeof block.name == 'string' ? block.name : 'tool',
    }
  }
  return undefined
}

// --- usage / model -------------------------------------------------------
// The terminal `usage` shape (T-16812), mapped to the provider-neutral Session
// columns the same way responses.ts maps OpenAI's: cache reads are `cached`,
// thinking tokens are `reasoning`. modelUsage/cost are richer facts T-16815 may
// keep from the opaque terminal; the four columns are what the graph bills on.
let usageOf = (value: unknown): UsageValue => {
  let u = record(value) ? value : {}
  let details = record(u.output_tokens_details) ? u.output_tokens_details : {}
  return {
    input: Number(u.input_tokens ?? 0),
    cached: Number(u.cache_read_input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
    reasoning: Number(details.thinking_tokens ?? 0),
  }
}

// The serving model the turn actually ran on: an assistant line names it
// exactly (`message.model`), init names it before the first token, and the
// terminal `modelUsage` carries it as a key. Prefer the most specific present.
let modelOf = (events: ClaudeEvent[]): string => {
  for (let event of events) {
    if (event.type != 'assistant') continue
    let message = event.message
    if (record(message) && typeof message.model == 'string' && message.model) {
      return message.model
    }
  }
  let init = events.find((e) => e.type == 'system' && e.subtype == 'init')
  if (init && typeof init.model == 'string' && init.model) return init.model
  let terminal = events.findLast((e) => e.type == 'result')
  let usage = terminal && record(terminal.modelUsage) ? terminal.modelUsage : {}
  let key = Object.keys(usage)[0]
  return key ?? ''
}

// --- parsed turn ---------------------------------------------------------
export type ClaudeTurn = {
  // Every scrubbed stream line in emission order — the raw parsed events, the
  // seam T-16815 (and T-16823's shared mapper) reads to build typed entries.
  events: ClaudeEvent[]
  model: string
  usage: UsageValue
  finalText: string
  // The CLI thread id these lines carry; recorded as provider replay state by
  // continuity (T-16816), never as Session lifecycle.
  providerSessionId: string
}

// A parse failure carries the inert events observed before it, so the scheduler
// can persist them as failed evidence (excluded from replay), mirroring the
// Codex poison rule. `.stderr` is a bounded, scrubbed diagnostic tail.
export type ClaudeStreamFault = Error & {
  events?: ClaudeEvent[]
  stderr?: string
}

let fault = (
  message: string,
  fields: { events?: ClaudeEvent[]; stderr?: string } = {},
): ClaudeStreamFault => Object.assign(new Error(message), fields)

// --- child process abstraction -------------------------------------------
export type ClaudeChild = {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  status: Promise<{ code: number; success: boolean }>
  kill: (signal?: Deno.Signal) => void
}

export type ClaudeLaunch = {
  argv: string[]
  cwd?: string
  env: Record<string, string>
}

export type ClaudeSpawn = (launch: ClaudeLaunch) => ClaudeChild

// The real transport: argv launch, piped stdout/stderr, a bounded child
// environment (childEnv — HOME carries subscription auth, PATH carries the
// provider CLIs), and no stdin (the prompt is a positional). Injectable so the
// parser is proved against the scrubbed fixture without shelling the CLI.
let denoSpawn: ClaudeSpawn = ({ argv, cwd, env }) => {
  let [command, ...args] = argv
  let child = new Deno.Command(command, {
    args,
    ...cwd ? { cwd } : {},
    clearEnv: true,
    env,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    status: child.status.then((s) => ({ code: s.code, success: s.success })),
    kill: (signal = 'SIGTERM') => {
      try {
        child.kill(signal)
      } catch {
        // It won the race and already exited.
      }
    },
  }
}

// A bounded line reader: whole newline-delimited lines only, each clipped so a
// pathological single line cannot grow the buffer without limit. The tail after
// the last newline is yielded at EOF (the terminal `result` line carries no
// trailing newline from some shells).
let LINE_MAX = 1024 * 1024
let lines = async function* (stream: ReadableStream<Uint8Array>) {
  let reader = stream.getReader()
  let decoder = new TextDecoder()
  let pending = ''
  while (true) {
    let part = await reader.read()
    pending += decoder.decode(part.value, { stream: !part.done })
    let split = pending.split('\n')
    pending = split.pop() ?? ''
    if (pending.length > LINE_MAX) pending = pending.slice(0, LINE_MAX)
    for (let line of split) yield line
    if (part.done) break
  }
  if (pending.trim()) yield pending
}

// Drain stderr into a bounded, scrubbed tail — diagnostic evidence for a
// failure, never blindly copied to a user-facing error.
let STDERR_MAX = 8192
let drainStderr = async (stream: ReadableStream<Uint8Array>) => {
  let reader = stream.getReader()
  let decoder = new TextDecoder()
  let out = ''
  try {
    while (true) {
      let part = await reader.read()
      if (part.done) break
      out += decoder.decode(part.value, { stream: true })
      if (out.length > STDERR_MAX) out = out.slice(-STDERR_MAX)
    }
  } catch {
    // A killed child's stderr can error mid-read; the tail we have is enough.
  }
  return scrub(out).trim()
}

export type PrintOptions = {
  argv: string[]
  cwd?: string
  env: Record<string, string>
  signal?: AbortSignal
  emit?: (delta: ObservationDelta) => void
  spawn?: ClaudeSpawn
}

// Run one bounded `claude -p` turn to a normalized ClaudeTurn, or throw a
// ClaudeStreamFault. A nonzero exit, a malformed line, an `is_error` terminal,
// or a vanished/killed child with no terminal are all durable failures; the
// caller stamps a sanitized error. On abort the child is killed and the throw
// is left for the scheduler's cancel gate to discard.
export let claudePrint = async (o: PrintOptions): Promise<ClaudeTurn> => {
  let child = (o.spawn ?? denoSpawn)({ argv: o.argv, cwd: o.cwd, env: o.env })
  let onAbort = () => child.kill()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  let stderr = drainStderr(child.stderr)
  let events: ClaudeEvent[] = []
  let terminal: ClaudeEvent | undefined
  let malformed = false
  let finalText = ''
  let providerSessionId = ''
  try {
    for await (let line of lines(child.stdout)) {
      if (!line.trim()) continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        malformed = true
        continue
      }
      if (!record(value) || typeof value.type != 'string') {
        malformed = true
        continue
      }
      let event = scrubDeep(value) as ClaudeEvent
      events.push(event)
      if (!providerSessionId && typeof event.session_id == 'string') {
        providerSessionId = event.session_id
      }
      if (event.type == 'assistant') {
        let block = blockOf(event)
        if (block?.type == 'text' && typeof block.text == 'string') {
          finalText = block.text
        }
      }
      if (event.type == 'result') terminal = event
      let delta = o.emit && claudeObservation(event)
      if (delta) o.emit!(delta)
    }
  } finally {
    o.signal?.removeEventListener('abort', onAbort)
  }
  let status = await child.status
  let tail = await stderr

  if (o.signal?.aborted) throw fault('claude: generation aborted', { events })
  if (malformed) {
    throw fault('claude: malformed stream', { events, stderr: tail })
  }
  if (!terminal) {
    let why = status.code ? ` (exit ${status.code})` : ''
    throw fault(`claude: stream ended without a result${why}`, {
      events,
      stderr: tail,
    })
  }
  if (terminal.is_error || !status.success) {
    let subtype = typeof terminal.subtype == 'string' ? terminal.subtype : ''
    let errors = Array.isArray(terminal.errors) ? terminal.errors : []
    let first = record(errors[0]) ? errors[0] : {}
    let raw = typeof first.message == 'string' ? first.message : tail
    let reason = reasonOf(raw)
    throw fault(
      `claude: ${subtype || 'failed'}${reason ? ` — ${reason}` : ''}`,
      { events, stderr: tail },
    )
  }
  // Terminal success: the result text is authoritative; usage/model close it.
  let result = typeof terminal.result == 'string' ? terminal.result : ''
  return {
    events,
    model: modelOf(events),
    usage: usageOf(terminal.usage),
    finalText: result || finalText,
    providerSessionId,
  }
}

// --- turn → GenerationWork (the mapping seam) ----------------------------
// A minimal, faithful mapping until T-16815's typed mapper lands. Assistant
// text and thinking take the existing compositions (message/reasoning + opaque
// evidence); a tool_use and its tool_result stay INERT opaque evidence keyed by
// their correlation id — no `call` facet, so entries.ts readySql never re-runs
// them — which is the atomic, unrunnable pair T-16815 promotes to typed
// call+result. Housekeeping lines (hooks, thinking-token estimates, rate
// limits) are transient noise, dropped from the durable log; every other
// well-formed line is preserved as named opaque evidence.
let noise = new Set(['hook_started', 'hook_response', 'thinking_tokens'])

// The correlation ids (message id, tool_use id, the event uuid) stay inside the
// opaque `data` JSON — the seam T-16815 reads to pair a tool_use with its
// result and to dedup. `output.key` is left unset here: the stream carries no
// key that is unique per entry AND stable (the scrubbed fixture reuses one
// uuid), and a generation's specs append exactly once, so no dedup key is owed
// yet. `output` still names the source generation for provenance and replay.
let opaque = (
  event: ClaudeEvent,
  generation: string,
  tag?: string,
): EntrySpec => ({
  output: { source: generation },
  opaque: { format: `anthropic:${tag ?? event.type}`, data: json(event) },
})

let eventSpecs = (event: ClaudeEvent, generation: string): EntrySpec[] => {
  if (event.type == 'system') {
    if (noise.has(String(event.subtype ?? ''))) return []
    if (event.subtype == 'init') return [opaque(event, generation, 'init')]
    return [opaque(event, generation)]
  }
  if (event.type == 'rate_limit_event') return []
  if (event.type == 'result') return [] // the terminal is the settlement
  let block = blockOf(event)
  if (event.type == 'assistant' && block) {
    if (block.type == 'text') {
      let body = typeof block.text == 'string' ? block.text : ''
      return [{
        output: { source: generation },
        message: { role: 'agent' },
        content: { body },
        opaque: { format: 'anthropic:message', data: json(event) },
      }]
    }
    if (block.type == 'thinking') {
      // `signature` is an opaque replay token — kept as evidence, never text.
      let body = typeof block.thinking == 'string' ? block.thinking : ''
      return [{
        output: { source: generation },
        reasoning: {},
        ...body.trim() ? { content: { body } } : {},
        opaque: { format: 'anthropic:thinking', data: json(event) },
      }]
    }
    // Claude already RAN this tool in-subprocess; record it inert (the tool id
    // is in the opaque data for T-16815 to pair with the result). NO `call`
    // facet, so entries.ts readySql never re-runs it.
    if (block.type == 'tool_use') return [opaque(event, generation, 'tool_use')]
    return [opaque(event, generation)]
  }
  if (event.type == 'user' && block?.type == 'tool_result') {
    return [opaque(event, generation, 'tool_result')]
  }
  return [opaque(event, generation)]
}

// Inert failed evidence: the completed items observed before a fault, excluded
// from replay (the Codex poison rule). Named `anthropic:failed:*` so a later
// projection can tell them from live evidence.
export let failedEvidence = (
  events: ClaudeEvent[],
  generation: string,
): EntrySpec[] =>
  events.map((event) => ({
    output: { source: generation },
    opaque: {
      format: `anthropic:failed:${event.type}`,
      data: json(event),
    },
  }))

export let claudeWork = (
  turn: ClaudeTurn,
  generation: string,
): GenerationWork => ({
  specs: turn.events.flatMap((event) => eventSpecs(event, generation)),
  // Claude ran its own tools; the scheduler must never execute anything.
  calls: [],
  usage: turn.usage,
  model: turn.model,
  finalText: turn.finalText,
})

// --- the generation runner -----------------------------------------------
// The prompt for a fresh bounded turn: the newest user input entry
// (message.role=user, no output). Multi-turn history and provider resume are
// continuity (T-16816); this seam sends one turn's instruction.
let promptOf = (entries: EntryRow[], generation: string): string => {
  let ordered = entries.toSorted((a, b) => a.seq - b.seq)
  let gen = ordered.find((row) => row.eid == generation)
  let seq = gen?.seq ?? Infinity
  let input = ordered.findLast((row) =>
    row.seq <= seq && row.comps.message?.role == 'user' && !row.comps.output
  )
  let body = input?.comps.content?.body
  if (typeof body != 'string' || !body.trim()) {
    throw new Error('claude generation has no user input')
  }
  return body
}

let valueOf = (entries: EntryRow[], generation: string) => {
  let gen = entries.find((row) => row.eid == generation)?.comps.generation
  if (!gen) throw new Error('no generation entry')
  return {
    model: String(gen.model ?? ''),
    effort: gen.effort ? String(gen.effort) : undefined,
  }
}

// The pinned print-mode contract (T-16812, D-16810). `--session-id` mints a
// fresh thread at a chosen uuid; `--no-session-persistence` leaves nothing on
// disk (the portable path — continuity T-16816 decides whether to keep an
// accelerator). `--` ends options so a dash-leading prompt is never a flag.
export let claudeArgv = (o: {
  sessionId: string
  model: string
  effort?: string
  prompt: string
}): string[] => [
  'claude',
  '-p',
  '--session-id',
  o.sessionId,
  '--output-format',
  'stream-json',
  '--verbose',
  ...o.model ? ['--model', o.model] : [],
  '--permission-mode',
  'bypassPermissions',
  ...o.effort ? ['--effort', o.effort] : [],
  '--no-session-persistence',
  '--',
  o.prompt,
]

export type ClaudeGenerationOptions = {
  spawn?: ClaudeSpawn
  // The bounded child environment; defaults to the shared allowlist (childEnv).
  env?: (tree: string | undefined) => Record<string, string>
  newId?: () => string
}

// The Claude entry in the generation dispatcher (managed_codex.ts `generators`):
// a bounded `claude -p` turn selected by generation.provider == 'claude'. Plugs
// into the same GenerationRunner contract as codexGeneration with no change to
// the scheduler.
export let claudeGeneration = (
  options: ClaudeGenerationOptions = {},
): GenerationRunner =>
async (ctx: GenerationContext): Promise<GenerationWork> => {
  let value = valueOf(ctx.entries, ctx.generation)
  let prompt = promptOf(ctx.entries, ctx.generation)
  let sessionId = (options.newId ?? (() => crypto.randomUUID()))()
  let argv = claudeArgv({ sessionId, prompt, ...value })
  let env = (options.env ?? ((tree) => childEnv(undefined, tree ?? '.')))(
    ctx.tree,
  )
  let turn: ClaudeTurn
  try {
    turn = await claudePrint({
      argv,
      cwd: ctx.tree,
      env,
      signal: ctx.signal,
      emit: ctx.emit,
      spawn: options.spawn,
    })
  } catch (error) {
    let raised = error instanceof Error ? error : new Error(String(error))
    let events = (raised as ClaudeStreamFault).events ?? []
    Object.assign(raised, {
      entrySpecs: failedEvidence(events, ctx.generation),
    })
    throw raised
  }
  return claudeWork(turn, ctx.generation)
}
