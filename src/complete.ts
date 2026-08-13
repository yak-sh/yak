// One question to a model, one reply — no session. The primitive that
// summarize/title/dedupe/classify need but that today each forces into a whole
// managed session: a worktree, a detached process under its own scope, a log
// file, a lifecycle, and a row on the board (T-12759, D-17362). This is the
// spawn→text floor and nothing more: it spawns a provider CLI in print mode
// over the SAME adapter table a managed session runs (adapters.ts), reads the
// stream to the reply, and returns the text.
//
// It touches NO graph state. The caller writes any result as ordinary graph
// data, so provenance is the writer's — and a model-produced value can never be
// a projection, so it enters as data minted once, not something a read derives.
//
// Graceful absence is the contract: no provider for the model, no CLI on PATH,
// a nonzero exit, or the deadline all yield `null`, never a throw. The feature
// that wanted a summary degrades to "not summarized," never to an error.
import { adapters } from './adapters.ts'
import { childEnv } from './agent_env.ts'
import { uuid } from './types.ts'

export type CompleteOpts = {
  effort?: string
  // Hard wall in ms — a one-shot that hangs is worse than no one-shot. On the
  // deadline the child is killed and the answer is null.
  deadline?: number
  cwd?: string
  env?: Record<string, string>
}

// The provider whose allowlist admits this model. Insertion order puts a
// graph-native provider ahead of its CLI fallback (codex before codex-cli), so
// a shared model resolves to the primary transport; `fake` stays selectable so
// the whole path is exercised without a model or a key.
let providerFor = (model: string) =>
  Object.values(adapters).find((a) => a.models.includes(model))

// Ask `model` one thing and get its reply, or null. `system` frames `user`:
// the CLI transport takes ONE positional prompt, so the two are joined rather
// than sent as separate roles — a per-provider system flag is the deliberate
// absence that keeps this file dialect-free. Reuses the adapter's own argv
// (print mode, no MCP config — that is added by sessions.ts, never argv) and
// its init/terminal readers (final_text lands in terminal for claude/fake, in
// init for codex), so a new provider works here for free.
export let complete = async (
  model: string,
  system: string,
  user: string,
  opts: CompleteOpts = {},
): Promise<string | null> => {
  let adapter = providerFor(model)
  if (!adapter) return null // unknown model — degrade, never throw
  let instruction = system.trim() ? `${system}\n\n${user}` : user
  let [command, ...args] = adapter.argv({
    instruction,
    session_id: uuid(),
    model,
    ...(opts.effort ? { effort: opts.effort } : {}),
  })
  let cwd = opts.cwd ?? Deno.cwd()
  let signal = AbortSignal.timeout(opts.deadline ?? 60_000)
  let out: Deno.CommandOutput
  try {
    out = await new Deno.Command(command, {
      args,
      cwd,
      clearEnv: true,
      env: opts.env ?? childEnv(undefined, cwd),
      stdin: 'null',
      stdout: 'piped',
      stderr: 'null',
      signal,
    }).output()
  } catch {
    return null // spawn failed: missing CLI (127/NotFound), or killed mid-spawn
  }
  if (!out.success) return null // nonzero exit or the deadline killed it

  // Read the stream the way a managed tail would, but keep only the reply: the
  // last final_text any line teaches (codex overwrites it per agent_message).
  let final: string | null = null
  for (let line of new TextDecoder().decode(out.stdout).split('\n')) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line)
    } catch {
      continue // a noise line is not the answer
    }
    let s = adapter.init(e) ?? adapter.terminal(e)
    if (s && 'final_text' in s && s.final_text != null) final = s.final_text
  }
  return final
}
