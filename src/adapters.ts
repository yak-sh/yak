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
import { type Session } from './types.ts'

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
  init: (e: Event) => Summary | null
  terminal: (e: Event) => Summary | null
}

// The table as a browser may see it (GET /providers): the names and the
// two allowlists a Run form offers, and nothing else — argv (and the
// paths in it) is this side's business. Derived, so a new provider needs
// no second edit.
export let providers = () =>
  Object.entries(adapters).map(([name, a]) => ({
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
  },

  // claude -p, stream-json: one JSON event per line. init announces the
  // session and the serving model; the `result` event is the last word.
  // --session-id hands the CLI OUR session uuid, so the provider's id and
  // ours are the same string — correlation for free.
  claude: {
    models: ['opus', 'sonnet', 'haiku'],
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
  },

  // codex exec --json. The stream never names its model, and text and
  // usage arrive in DIFFERENT events — so init() also harvests each
  // agent_message as it lands (drain merges every pass; the last one
  // standing is the final text) and turn.completed closes with usage.
  codex: {
    models: ['gpt-5.6-sol'],
    efforts: ['low', 'medium', 'high', 'xhigh'],
    argv: (j) => [
      'codex',
      'exec',
      '--json',
      '-s',
      'workspace-write', // its worktree is its workspace
      '-m',
      j.model,
      ...(j.effort ? ['-c', `model_reasoning_effort=${j.effort}`] : []),
      j.instruction,
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
  },
}
