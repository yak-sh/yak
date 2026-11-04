// Explicit 1Password reads for a person's interactive command. Runtime
// secret readers (reveal and peek) never start op. A read uses a cleared
// environment, closed stdin, bounded output and the caller's abort signal.

/** Resolve a reference to its value. Injectable, so a test needs no `op`. */
export type OpRead = (reference: string, signal: AbortSignal) => Promise<string>

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

// What op answered: the value, or its own words as the error.
let answer = (
  out: { success: boolean; stdout: Uint8Array; stderr: Uint8Array },
): string => {
  if (!out.success) {
    throw new Error(
      dec.decode(out.stderr.slice(0, MAX_OUT)).trim() || 'op read failed',
    )
  }
  return dec.decode(out.stdout.slice(0, MAX_OUT))
}

/** `op read`, awaited under the signal it is given. */
export let opRead =
  (environment?: Env): OpRead => async (reference, signal) => {
    let [{ command }, { env }, { isNotFound }] = await Promise.all([
      import('@yaks/process/command'),
      import('@yaks/process/system'),
      import('@yaks/file/io'),
    ])
    let out = await command('op', {
      args: ['read', '--no-newline', reference],
      clearEnv: true,
      env: opEnv(environment ?? env.get),
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
      signal,
    }).output().catch((error) => {
      throw isNotFound(error)
        ? new Error('op is not installed or not on PATH')
        : error
    })
    return answer(out)
  }
