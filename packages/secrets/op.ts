// Explicit 1Password reads for a person's interactive command, and the
// keeper that writes a key given to the box into 1Password. Runtime
// secret readers (reveal and peek) never start op. A read uses a cleared
// environment, closed stdin, bounded output and the caller's abort signal.
import { command } from '@yaks/process/command'
import { env } from '@yaks/process/env'
import { isNotFound } from '@yaks/file/io'
import { reveal } from './reveal.ts'
import type { Vault } from './vault.ts'

/** Resolve a reference to its value. Injectable, so a test needs no `op`. */
export type OpRead = (reference: string, signal: AbortSignal) => Promise<string>

let MAX_OUT = 65_536

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

/** One `op` command with its input on stdin, answered with its output. */
export type OpRun = (
  args: string[],
  input?: string,
) => Promise<{ success: boolean; stdout: Uint8Array; stderr: Uint8Array }>

/** `op`, run with the environment {@link opRead} gives it and `input` on its
 * stdin, so a value never rides its arguments. */
export let opRun = (environment?: Env): OpRun => async (args, input) => {
  let child = command('op', {
    args,
    clearEnv: true,
    env: opEnv(environment ?? env.get),
    stdin: input == null ? 'null' : 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  if (input != null) {
    let w = child.stdin.getWriter()
    await w.write(new TextEncoder().encode(input))
    await w.close()
  }
  return await child.output()
}

/** Where a key goes in 1Password: `<vault>/<item>`, or `<vault>/<item>/<field>`
 * for a field other than an API credential's `credential`. */
let placeOf = (at: string) => {
  let [vault, item, field = 'credential', ...rest] = at.split('/')
  if (!vault || !item || rest.length) {
    throw new Error(`a 1Password place is <vault>/<item>[/<field>], not ${at}`)
  }
  return { vault, item, field }
}

type Item = {
  id?: string
  title?: string
  category?: string
  fields?: { id?: string; label?: string; type?: string; value?: string }[]
}

/** Keeps a key in 1Password at `<vault>/<item>[/<field>]`: the item's field is
 * set where the item stands, and an API credential item is made where it does
 * not. The value goes to `op` on its stdin, inside an item's JSON, never in
 * its arguments.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let calls: [string[], string | undefined][] = []
 * let run: OpRun = (args, input) => {
 *   calls.push([args, input])
 *   let stuck = args[1] == 'get'
 *   return Promise.resolve({
 *     success: !stuck,
 *     stdout: new Uint8Array(),
 *     stderr: new TextEncoder().encode(stuck ? '"Logs" isn\'t an item' : ''),
 *   })
 * }
 * await opKeep(run)('Shared/Logs', 'k')
 * assertEquals(calls[1][0], ['item', 'create', '--vault', 'Shared', '-'])
 * assertEquals(JSON.parse(calls[1][1]!).fields[0].value, 'k')
 * ```
 */
export let opKeep = (run: OpRun = opRun()) =>
async (
  at: string,
  value: string,
): Promise<void> => {
  let { vault, item, field } = placeOf(at)
  let got = await run([
    'item',
    'get',
    item,
    '--vault',
    vault,
    '--format',
    'json',
  ])
  if (!got.success) {
    let why = dec.decode(got.stderr)
    if (!/isn't an item/.test(why)) answer(got)
    let made: Item = {
      title: item,
      category: 'API_CREDENTIAL',
      fields: [{ id: field, label: field, type: 'CONCEALED', value }],
    }
    answer(
      await run(
        ['item', 'create', '--vault', vault, '-'],
        JSON.stringify(made),
      ),
    )
    return
  }
  let held = JSON.parse(answer(got)) as Item
  let fields = held.fields ?? []
  let at_ = fields.find((f) => f.id == field || f.label == field)
  if (at_) at_.value = value
  else fields.push({ id: field, label: field, type: 'CONCEALED', value })
  answer(
    await run(
      ['item', 'edit', held.id ?? item, '--vault', vault],
      JSON.stringify({ ...held, fields }),
    ),
  )
}

/** The `1password` keeper a host lends (@yaks/host/keepers): {@link opKeep}
 * signed in as the service account whose token is `OP_SERVICE_ACCOUNT_TOKEN`
 * in `vault`, else in the environment, read at each keep. */
export let opKeeper = (vault: Vault) => ({
  keep: async (at: string, value: string): Promise<void> => {
    let token = await reveal(vault, TOKEN)
    if (!token) {
      throw new Error(`${TOKEN} is in neither the vault nor the environment`)
    }
    await opKeep(opRun((name) => name == TOKEN ? token : env.get(name)))(
      at,
      value,
    )
  },
})

let TOKEN = 'OP_SERVICE_ACCOUNT_TOKEN'
