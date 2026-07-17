// The provider seam: what a managed session RUNS, and how to read what it
// prints. One hard-coded table — a provider is its argv, the two
// allowlists a start request is checked against, and the two readers that
// turn its JSONL into session summary columns. Every provider speaks the
// same shape (a line of JSON per event), so sessions.ts never learns a
// vendor's dialect: it asks the adapter "is this the init?", "is this the
// end?" and stamps whatever comes back.
//
// v0 ships `fake` only; claude and codex land next as siblings in this
// table — a new provider is one entry, nothing else.
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

// The fake provider ships in this repo: `deno run` it by absolute path, so
// the child's minimal env (no cwd-relative anything) still finds it.
let fake = new URL('./fake-provider.ts', import.meta.url).pathname

export let adapters: Record<string, Adapter> = {
  fake: {
    models: ['fake-fast', 'fake-slow'],
    efforts: ['low', 'medium', 'high'],
    argv: (j) => [
      'deno',
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
}
