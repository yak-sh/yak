// A systemd ExecStopPost reports outside the failed process, so a timeout or
// SIGKILL cannot silence it. The manager's exit metadata, never its environment
// wholesale or a journal containing request data, goes to the ordinary spool.
import type { Command } from './run.ts'
import { read } from './config.ts'
import { reporter } from './report.ts'

export type UnitExit = {
  unit: string
  result?: string
  code?: string
  status?: string
  invocation?: string
}

export let unitFailure = (exit: UnitExit): Error | undefined => {
  if (!exit.result || exit.result == 'success') return
  return Object.assign(
    new Error(
      `systemd unit ${exit.unit} failed: ${exit.result} (${
        exit.code ?? 'unknown'
      } ${exit.status ?? 'unknown'})`,
    ),
    { name: 'SystemdUnitFailure' },
  )
}

export let reportUnit = async (
  exit: UnitExit,
  report: (error: Error, tags: Record<string, string>) => Promise<void>,
): Promise<void> => {
  let error = unitFailure(exit)
  if (!error) return
  await report(
    error,
    Object.fromEntries(
      Object.entries(exit).filter((pair): pair is [string, string] =>
        typeof pair[1] == 'string'
      ),
    ),
  )
}

export let unitFailureCommand: Command = {
  name: 'unit_failure',
  noun: 'unit',
  verb: 'failure',
  description:
    'Report a failed systemd unit from ExecStopPost to the configured tracker spool',
  positional: ['unit'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['unit'],
    properties: {
      unit: { type: 'string', description: 'the unit that ended (%n)' },
    },
  },
  run: async (args, context) => {
    let exit: UnitExit = {
      unit: String(args.unit),
      result: Deno.env.get('SERVICE_RESULT'),
      code: Deno.env.get('EXIT_CODE'),
      status: Deno.env.get('EXIT_STATUS'),
      invocation: Deno.env.get('INVOCATION_ID'),
    }
    if (!unitFailure(exit)) return 0
    if (!context.config) throw new Error('unit failure needs --config')
    let config = read(context.config)
    if (!config.tracker) throw new Error('unit failure needs a tracker spool')
    let report = reporter(config, undefined, undefined, {
      command: 'systemd unit',
      source: 'systemd',
    })
    await reportUnit(exit, (error, tags) => report(error, { tags }))
    await report.close()
    return 0
  },
}
