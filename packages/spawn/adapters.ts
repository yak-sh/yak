// What a managed session runs: a provider's argv, and the reader that makes its
// JSON-lines output a transcript (@yaks/session's `claude` and `codex`) — code,
// and only code. Which providers exist and which models each one serves is
// graph data (@yaks/model's `provider` and `model` entities), so adding a model
// means inserting a row, not cutting a release.
//
// Every provider prints one JSON object per event, so ./run.ts never learns a
// vendor's format: @yaks/session's importer asks the reader what a line means
// and appends whatever comes back.

import { type Reader, readers } from '@yaks/session'

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
  /** what each line of its output means (@yaks/session) */
  read: Reader
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
  read: readers.claude,
}

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
  read: readers.codex,
}

/**
 * The providers run as commands, keyed by the `name` on their `provider`
 * entity. A server with a provider of its own builds its own table
 * ({@link https://jsr.io/@yaks/spawn/doc/effects/~/spawning | spawning}). A
 * provider missing from this table is one this package does not launch, which
 * is how an `http` provider is left to the in-process daemon.
 */
export let adapters: Record<string, Adapter> = { claude, codex }
