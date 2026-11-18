// A test account for the length of one command: sign in, run the command as
// the account, sign out. The account reaches the command through its own
// environment, so no other process on the box sees it selected. A terminal
// command, because a stored tool call must not be able to run a shell.

import { command as processCommand } from '@yaks/process/command'
import type { CliCommand } from '@yaks/cli/host'
import { person } from '@yaks/cli/config'
import { AccountError, authorize, pick } from '@yaks/connections'
import { authorizeCLI } from '@yaks/connections/authorize-cli'
import { yaksApp } from '@yaks/connections/yaks-app'
import { ADMIN, BOT } from '@yaks/platform/bots'
import { account } from './account.ts'
import { erase } from './erase.ts'
import { closeAccount } from './api.ts'
import { Refused } from './refusal.ts'

type Host = Parameters<CliCommand['run']>[1]

/** Run a shell command under these variables, answering its exit code. */
export type Run = (
  command: string,
  env: Record<string, string>,
) => Promise<number>

let shell: Run = async (command, env) =>
  (await processCommand('sh', { args: ['-c', command], env }).spawn().status)
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

// A temporary account enters recoverable trash when its command ends.
// A failed cleanup keeps its credentials available for recovery.
let erased = async (host: Host, address: string) => {
  try {
    await erase(host, (await account(host)(address)).bearer, address)
  } catch (error) {
    console.error(`${address} and its credentials are retained: ${error}`)
  }
}

/** Keep a test account for one operation, including a sign-in that fails
 * after writing its connection. An existing connection and account stay. */
export let temporary = async <T>(
  host: Host,
  name: string,
  run: (address: string) => Promise<T>,
  enter: typeof signIn = signIn,
): Promise<T> => {
  let owner = await person(host)
  if (!owner) throw new Refused('A configured person is required')
  let address = `${name}${BOT}`
  let kept = await held(host, owner, address)
  try {
    if (kept && address != ADMIN) {
      let admin = await account(host)(ADMIN)
      if ((await closeAccount(admin.bearer, address, true)).trashed) {
        await closeAccount(admin.bearer, address, false, true)
      }
    }
    if (!kept) await enter(host, owner, address)
    return await run(address)
  } finally {
    if (!kept && await held(host, owner, address)) await erased(host, address)
  }
}

/** The command, with the seams a test replaces. */
export let throwaway = (
  run: Run = shell,
  enter: typeof signIn = signIn,
): CliCommand['run'] =>
(args, host) => {
  let name = typeof args.name == 'string' && args.name
    ? args.name
    : `probe-${crypto.randomUUID().slice(0, 6)}`
  return temporary(host, name, (address) =>
    // A token in the environment outranks any selection (@yaks/cli accounts).
    run(String(args.command), { YAK_AS: address, YAKS_TOKEN: '' }), enter)
}
