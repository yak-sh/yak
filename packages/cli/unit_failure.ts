// A systemd ExecStopPost reports outside the failed process, so a timeout or
// SIGKILL cannot silence it. Exit metadata and bounded output from that
// invocation go to the ordinary spool; the environment is never copied.
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

export type JournalRun = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string }>

let journalRun: JournalRun = async (command, args) => {
  let output = await new Deno.Command(command, {
    args,
    stdout: 'piped',
    stderr: 'null',
    stdin: 'null',
  }).output()
  return { code: output.code, stdout: new TextDecoder().decode(output.stdout) }
}

/** Read only this invocation, never a previous restart's output. Journald
 * merges stdout and stderr for these units, so retain both. A host whose
 * runtime journal is root-only may allow a noninteractive privileged read. */
export let unitOutput = async (
  exit: UnitExit,
  run: JournalRun = journalRun,
): Promise<string> => {
  if (!exit.invocation || !/^[a-f0-9]{32}$/i.test(exit.invocation)) return ''
  let args = [
    '--quiet',
    '--no-pager',
    '--output=cat',
    '--lines=40',
    `_SYSTEMD_USER_UNIT=${exit.unit}`,
    `_SYSTEMD_INVOCATION_ID=${exit.invocation}`,
    `_UID=${Deno.uid()}`,
    '_TRANSPORT=stdout',
  ]
  for (
    let [command, prefix] of [
      ['journalctl', []],
      ['sudo', ['-n', 'journalctl']],
    ] as const
  ) {
    try {
      let output = await run(command, [...prefix, ...args])
      if (output.code == 0 && output.stdout.trim()) {
        // deno-lint-ignore no-control-regex -- remove journald's ANSI styling
        return output.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
          .slice(-8192).trim()
      }
    } catch { /* A missing journal must not silence the failure report. */ }
  }
  return ''
}

export let reportUnit = async (
  exit: UnitExit,
  report: (error: Error, tags: Record<string, string>) => Promise<void>,
  output: (exit: UnitExit) => Promise<string> = unitOutput,
): Promise<void> => {
  let error = unitFailure(exit)
  if (!error) return
  let stderr = await output(exit)
  await report(
    error,
    {
      ...Object.fromEntries(
        Object.entries(exit).filter((pair): pair is [string, string] =>
          typeof pair[1] == 'string'
        ),
      ),
      ...stderr ? { stderr } : {},
    },
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
