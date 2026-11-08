// An OAuth client, or a broker's key, copied explicitly from 1Password by the
// person at a terminal. These commands are never a stored call a server can
// replay.
import type { CliCommand } from '@yaks/cli/host'
import { isOpRef } from '@yaks/secrets'
import { type OpRead, opRead } from '@yaks/secrets/op'
import { CallError } from '@yaks/tools/errors'
import { account } from './account.ts'
import { keepBroker, keepClient, renewing, zone } from './api.ts'

export let client = (read: OpRead = opRead()): CliCommand['run'] =>
async (
  args,
  host,
  context,
) => {
  let name = String(args.name)
  let refs = {
    id: String(args.id),
    secret: args.secret as string | undefined,
  }
  for (let [arg, ref] of Object.entries(refs)) {
    if (ref != null && !isOpRef(ref)) {
      throw new CallError(arg, 'an op:// reference, never the value itself')
    }
  }
  try {
    let at = await account(host)(args.as as string | undefined ?? context.as)
    let signal = AbortSignal.timeout(10_000)
    await keepClient(at.bearer, name, {
      id: await read(refs.id, signal),
      ...refs.secret ? { secret: await read(refs.secret, signal) } : {},
    })
    context.out(`kept the ${name} OAuth client on ${zone()}`)
    return 0
  } finally {
    renewing(() => {})
  }
}

export let broker = (read: OpRead = opRead()): CliCommand['run'] =>
async (
  args,
  host,
  context,
) => {
  let name = String(args.name)
  let ref = String(args.key)
  if (!isOpRef(ref)) {
    throw new CallError('key', 'an op:// reference, never the value itself')
  }
  try {
    let at = await account(host)(args.as as string | undefined ?? context.as)
    await keepBroker(
      at.bearer,
      name,
      await read(ref, AbortSignal.timeout(10_000)),
    )
    context.out(`kept the ${name} broker's key on ${zone()}`)
    return 0
  } finally {
    renewing(() => {})
  }
}
