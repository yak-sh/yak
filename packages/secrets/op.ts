// A value that lives in 1Password: the vault keeps its `op://` reference and
// the value is read with `op read` at the moment it is used, so it never rests
// on this machine at all.
//
// `op` is bounded on every axis it touches: no shell, a cleared environment
// but for what the CLI needs to find its own session, stdin closed so it never
// waits on a prompt, a deadline, and a capped read. A failure is a thrown
// error with op's own words, never a stale value.

/** Resolve a reference to its value. Injectable, so a test needs no `op`. */
export type OpRead = (reference: string, signal: AbortSignal) => Promise<string>

let DEADLINE_MS = 5000
let MAX_OUT = 65_536

/** Whether a written value is a reference rather than a value: `op://` and at
 * least vault, item and field. Spaces are fine — it is an argument, never a
 * shell word — but a control character is not. */
export let isOpRef = (value: string): boolean =>
  value.startsWith('op://') &&
  // deno-lint-ignore no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value) &&
  value.slice(5).split('/').filter((s) => s.length > 0).length >= 3

// All `op` may see of this process's environment: where to find itself, and
// the session a person or a service account signed it into.
let opEnv = (env: (name: string) => string | undefined) => {
  let out: Record<string, string> = {
    PATH: env('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
  }
  for (let name of ['HOME', 'XDG_CONFIG_HOME', 'OP_SERVICE_ACCOUNT_TOKEN']) {
    let value = env(name)
    if (value) out[name] = value
  }
  return out
}

let dec = new TextDecoder()

// The runtime's way to start a process, as much of it as `op read` needs. A
// Worker has none, and this package runs in one (yaks.app), so it is looked
// for rather than assumed.
type Output = { success: boolean; stdout: Uint8Array; stderr: Uint8Array }
type Runtime = {
  Command: new (
    cmd: string,
    opts: Record<string, unknown>,
  ) => { output(): Promise<Output> }
  errors: { NotFound: new (...a: never[]) => Error }
  env: { get(name: string): string | undefined }
}
let runtime = () => (globalThis as { Deno?: Runtime }).Deno

/** `op read`, run the way the header says. */
export let opRead = (
  env: (name: string) => string | undefined = (n) => runtime()?.env.get(n),
): OpRead =>
async (reference, signal) => {
  let deno = runtime()
  if (!deno) throw new Error('op needs a runtime that can start a process')
  let out: Output
  try {
    out = await new deno.Command('op', {
      args: ['read', '--no-newline', reference],
      clearEnv: true,
      env: opEnv(env),
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
      signal,
    }).output()
  } catch (e) {
    if (e instanceof deno.errors.NotFound) {
      throw new Error('op is not installed or not on PATH')
    }
    throw e
  }
  if (!out.success) {
    throw new Error(
      dec.decode(out.stderr.slice(0, MAX_OUT)).trim() || 'op read failed',
    )
  }
  return dec.decode(out.stdout.slice(0, MAX_OUT))
}

/** The deadline one read is given. */
export let deadline = (): AbortSignal => AbortSignal.timeout(DEADLINE_MS)
