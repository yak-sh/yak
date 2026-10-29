// A systemd ExecStopPost reports outside the failed process, so a timeout or
// SIGKILL cannot silence it. Exit metadata and bounded output from that
// invocation go to the ordinary spool; the environment is never copied.
//
// A clean stop is a failure too when it leaves its template with no instance
// ready: an in-place `systemctl restart` of the only web refuses every
// connection until the new one listens, and an MCP client that retries for
// seconds gives up for good. `yak restart` stops old units only once their
// replacements are ready (./restart.ts), so a handover reports nothing.
import type { Command } from './run.ts'
import { read } from './config.ts'
import { reporter } from './report.ts'
import { ready, readyFile } from './restart.ts'

export type UnitExit = {
  unit: string
  result?: string
  code?: string
  status?: string
  invocation?: string
  /** how many other instances of the unit's template are ready, when asked
   * (`others`) */
  others?: number
}

export let unitFailure = (exit: UnitExit): Error | undefined => {
  if (exit.result == 'success' && exit.others === 0) {
    return Object.assign(
      new Error(
        `systemd unit ${exit.unit} stopped with no other ${
          instanceOf(exit.unit)?.[0]
        }@ ready, so nothing serves it until one starts; ` +
          '`yak restart` hands over ready-first',
      ),
      { name: 'SystemdUnitAlone' },
    )
  }
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

/** The template and instance of a unit such as `yak-web@<id>.service`. */
let instanceOf = (unit: string): [string, string] | undefined => {
  let found = unit.match(/^(.+)@(.+)\.service$/)
  return found ? [found[1], found[2]] : undefined
}

export type Run = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string }>

/** How many other active instances of `unit`'s template are ready, by user
 * systemd and the ready files in `runtimeDir`. Undefined when that is no
 * question: a unit that is no template instance, or a manager that is
 * stopping, when every unit stops at once. */
export let others = async (
  unit: string,
  runtimeDir: string,
  run: Run = execute,
  exists: (path: string) => Promise<boolean> = ready,
): Promise<number | undefined> => {
  let template = instanceOf(unit)?.[0]
  if (!template) return
  let state = await run('systemctl', ['--user', 'is-system-running'])
  if (state.stdout.trim() == 'stopping') return
  let listed = await run('systemctl', [
    '--user',
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    '--no-pager',
    `${template}@*.service`,
  ])
  if (listed.code) throw new Error(`systemctl could not list ${template}@`)
  let instances = listed.stdout.split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((peer) => peer != unit)
    .flatMap((peer) => instanceOf(peer)?.slice(1) ?? [])
  let found = await Promise.all(
    instances.map((i) => exists(readyFile(runtimeDir, template, i))),
  )
  return found.filter(Boolean).length
}

let execute: Run = async (command, args) => {
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
  run: Run = execute,
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
        Object.entries(exit).filter(([, value]) => value != null)
          .map(([key, value]) => [key, String(value)]),
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
    'Report a systemd unit that failed, or stopped with no other instance of its template ready, from ExecStopPost to the configured tracker spool',
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
    let runtimeDir = Deno.env.get('XDG_RUNTIME_DIR')
    if (exit.result == 'success' && runtimeDir) {
      exit.others = await others(exit.unit, runtimeDir)
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
