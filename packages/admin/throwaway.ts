// A test account for the length of one command: sign in, run the command as
// the account, sign out. The account reaches the command through its own
// environment, so no other process on the box sees it selected. A terminal
// command, because a stored tool call must not be able to run a shell.
import type { CliCommand } from '@yaks/cli/host'
import { person } from '@yaks/cli/config'
import { AccountError, authorize, disconnect, pick } from '@yaks/connections'
import { authorizeCLI } from '@yaks/connections/authorize-cli'
import { yaksApp } from '@yaks/connections/yaks-app'
import { BOT } from '../../workers/yak/lib/bots.ts'
import { Refused } from './refusal.ts'

type Host = Parameters<CliCommand['run']>[1]

/** Run a shell command under these variables, answering its exit code. */
export type Run = (
  command: string,
  env: Record<string, string>,
) => Promise<number>

let shell: Run = async (command, env) =>
  (await new Deno.Command('sh', { args: ['-c', command], env }).spawn().status)
    .code

let signIn = async (host: Host, owner: string, address: string) => {
  await authorizeCLI(
    authorize({ graph: host.graph, vault: host.vault, owner }, yaksApp(host)),
    'yaks.app',
    undefined,
    address,
  )
}

let held = async (host: Host, owner: string, address: string) => {
  try {
    return await pick(host.graph.read, owner, 'yaks.app', address)
  } catch (error) {
    if (error instanceof AccountError) return undefined
    throw error
  }
}

/** The command, with the seams a test replaces. A connection that was there
 * before the command stays after it: a name can land on an account someone
 * signed in to on purpose, `admin` among them. */
export let throwaway = (
  run: Run = shell,
  enter: typeof signIn = signIn,
): CliCommand['run'] =>
async (args, host) => {
  let owner = await person(host)
  if (!owner) throw new Refused('A configured person is required')
  let name = typeof args.name == 'string' && args.name
    ? args.name
    : `probe-${crypto.randomUUID().slice(0, 6)}`
  let address = `${name}${BOT}`
  let kept = await held(host, owner, address)
  if (!kept) await enter(host, owner, address)
  try {
    // A token in the environment outranks any selection (@yaks/cli accounts).
    return await run(String(args.command), {
      YAK_AS: address,
      YAKS_TOKEN: '',
    })
  } finally {
    let made = kept ? undefined : await held(host, owner, address)
    if (made) await disconnect(host, made.entity.eid)
  }
}
