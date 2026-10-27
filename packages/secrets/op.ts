// A value that lives in 1Password: the vault keeps its `op://` reference and
// the value is read with `op read` at the moment it is used, so it never rests
// on this machine at all.
//
// `op` is bounded on every axis it touches: no shell, a cleared environment
// but for what the CLI needs to find its own session, stdin closed so it never
// waits on a prompt, and a capped read. A read that is awaited has a deadline;
// one answered on the spot (`opReadNow`) holds its thread until op gives up on
// its own, about a minute for a network it cannot reach. A failure is a thrown
// error with op's own words, never a stale value.

/** Resolve a reference to its value. Injectable, so a test needs no `op`. */
export type OpRead = (reference: string, signal: AbortSignal) => Promise<string>

/** The same, answered before it returns: for a value read on the spot. */
export type OpReadNow = (reference: string) => string

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

type Env = (name: string) => string | undefined

// All `op` may see of this process's environment: where to find itself, and
// the session a person or a service account signed it into.
let opEnv = (env: Env) => {
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
  ) => { output(): Promise<Output>; outputSync(): Output }
  errors: { NotFound: new (...a: never[]) => Error }
  env: { get(name: string): string | undefined }
}
let runtime = (): Runtime => {
  let deno = (globalThis as { Deno?: Runtime }).Deno
  if (!deno) throw new Error('op needs a runtime that can start a process')
  return deno
}
let processEnv: Env = (n) => runtime().env.get(n)

// `op read`, run the way the header says.
let read = (deno: Runtime, env: Env, reference: string, signal?: AbortSignal) =>
  new deno.Command('op', {
    args: ['read', '--no-newline', reference],
    clearEnv: true,
    env: opEnv(env),
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    ...signal ? { signal } : {},
  })

// An op that could not start because it is not there says so.
let absent = (deno: Runtime, e: unknown) =>
  e instanceof deno.errors.NotFound
    ? new Error('op is not installed or not on PATH')
    : e

// What op answered: the value, or its own words as the error.
let answer = (out: Output): string => {
  if (!out.success) {
    throw new Error(
      dec.decode(out.stderr.slice(0, MAX_OUT)).trim() || 'op read failed',
    )
  }
  return dec.decode(out.stdout.slice(0, MAX_OUT))
}

/** `op read`, awaited under the signal it is given. */
export let opRead =
  (env: Env = processEnv): OpRead => async (reference, signal) => {
    let deno = runtime()
    let out = await read(deno, env, reference, signal).output()
      .catch((e) => Promise.reject(absent(deno, e)))
    return answer(out)
  }

/** `op read`, answered before it returns. */
export let opReadNow = (env: Env = processEnv): OpReadNow => (reference) => {
  let deno = runtime()
  let out: Output
  try {
    out = read(deno, env, reference).outputSync()
  } catch (e) {
    throw absent(deno, e)
  }
  return answer(out)
}

/** The deadline one read is given. */
export let deadline = (): AbortSignal => AbortSignal.timeout(DEADLINE_MS)
