import * as disk from '@yaks/file/io'
import { command as launchCommand } from '@yaks/process/command'
// Ready-first handover for the box's processes. Each role's replacement is
// started from its unit template and waited on until it says it is ready (its
// readiness file); only once every replacement is ready are the old units asked
// to stop, without waiting for them. A worker is ready once its pool and graph
// are assembled, and its old one drains its steps in flight. A web is ready
// once it is listening: it shares its port with the one it replaces
// (`yak serve --share`), so nothing is refused while the old one stops.

export type Role = {
  unit: string
  old: string[]
  optional?: boolean
}

export type RestartOptions = {
  /** Wait for, then hold, the box's one handover lock, which keeps the last
   * successful handover's record. */
  lock?: (path: string) => Promise<Held>
  processes?: import('./config.ts').Config['processes']
  runtimeDir: string
  roles?: Role[]
  systemctl?: string
  run?: (
    command: string,
    args: string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>
  ready?: (path: string) => Promise<boolean>
  now?: () => number
  /** Wall-clock milliseconds, finer than one, shared by every caller on the
   * box. */
  clock?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export type Held = {
  read: () => Promise<string>
  write: (text: string) => Promise<void>
  close: () => void
}

/** The box's roles: its graph's workers and web, then the tracker's, rolled
 * only where they run. */
export let ROLES: Role[] = [
  { unit: 'yak-work', old: ['yak-work@*.service'] },
  { unit: 'yak-tracker', old: ['yak-tracker@*.service'], optional: true },
  { unit: 'yak-web', old: ['yak-web@*.service'] },
  {
    unit: 'yak-tracker-web',
    old: ['yak-tracker-web@*.service'],
    optional: true,
  },
]

/** The supervised handover waits for readiness without holding its caller. */
export let PATIENCE = 120_000

/** One systemctl or systemd-run call only queues a job, but on a box busy with
 * landings and restarts that alone can take seconds; a tighter bound aborted
 * a handover halfway, leaving its ready replacements beside the old units. */
let CALL = 30_000

let run: NonNullable<RestartOptions['run']> = async (command, args) => {
  let result = await launchCommand(command, {
    args,
    signal: AbortSignal.timeout(CALL),
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let decoder = new TextDecoder()
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  }
}

/** Queue one supervised handover; its completion never holds the caller.
 * `launch` invokes this CLI, and `run` is the same command boundary as restart.
 * ExecStopPost reports failures even if systemd kills the handover. */
export let queueRestart = async (
  launch: string[],
  config?: string,
  execute: NonNullable<RestartOptions['run']> = run,
): Promise<string> => {
  let aimed = config ? [...launch, '--config', config] : launch
  // systemd parses ExecStopPost as an argv, not a shell command. Literal
  // percent signs must not become unit specifiers.
  let quote = (word: string) =>
    '"' + word.replace(/[%$\\"]/g, (c) =>
      c == '%' || c == '$' ? c + c : '\\' + c) +
    '"'
  // Each queued handover is its own unit, so a second one queues behind the
  // running one's lock instead of being refused.
  let unit = `yak-restart-${crypto.randomUUID()}`
  let report = [...aimed, 'unit', 'failure', `${unit}.service`]
    .map(quote).join(' ')
  let result = await execute('systemd-run', [
    '--user',
    '--no-block',
    '--no-ask-password',
    '--expand-environment=no',
    '--quiet',
    '--collect',
    `--unit=${unit}`,
    '--property=Type=exec',
    `--property=ExecStopPost=${report}`,
    '--',
    ...aimed,
    'restart',
    '--handover',
  ])
  if (result.code) {
    throw new Error(`Could not queue restart: ${result.stderr.trim()}`)
  }
  return `Restart queued in ${unit}.service; handover and failure reporting continue in the background`
}

/** Where an instance of a unit template says it is ready: the file its
 * `--ready` names, `<runtime>/<template>-<instance>.ready`. */
export let readyFile = (
  runtimeDir: string,
  template: string,
  instance: string,
): string => `${runtimeDir.replace(/\/$/, '')}/${template}-${instance}.ready`

/** Whether a ready file is there. */
export let ready = async (path: string): Promise<boolean> => {
  try {
    return (await disk.stat(path)).isFile
  } catch (error) {
    if (error instanceof disk.errors.NotFound) return false
    throw error
  }
}

let matches = (pattern: string, unit: string) => {
  let [before, after] = pattern.split('*')
  return after == null
    ? unit == before
    : unit.startsWith(before) && unit.endsWith(after)
}

// Keep the inode: unlinking it would let a waiter and a new caller lock
// different files, so the record is written in place. The OS releases the lock
// even if the CLI is killed.
let lock = async (path: string): Promise<Held> => {
  let file = await disk.open(path, { create: true, write: true })
  try {
    await file.lock(true)
  } catch (error) {
    file.close()
    throw error
  }
  return {
    read: () => disk.readTextFile(path),
    write: (text) => disk.writeTextFile(path, text),
    close: () => file.close(),
  }
}

/** Serialize the snapshot and handover across CLI processes. A second caller
 * waits for the running handover; if one began after it was called, that one
 * already started its code, so it coalesces into it instead of rolling again. */
export let restart = async (options: RestartOptions): Promise<string> => {
  let clock = options.clock ??
    (() => performance.timeOrigin + performance.now())
  let asked = clock()
  let held = await (options.lock ?? lock)(
    `${options.runtimeDir.replace(/\/$/, '')}/yak-restart.lock`,
  )
  try {
    let text = await held.read()
    let last: { began: number; said: string } | undefined = text
      ? JSON.parse(text)
      : undefined
    if (last && last.began > asked) {
      return `Coalesced into the restart that began at ${
        new Date(last.began).toISOString()
      }, after this call:\n${last.said}`
    }
    let began = clock()
    let said = await handover(options)
    await held.write(JSON.stringify({ began, said }))
    return said
  } finally {
    held.close()
  }
}

/** Hand every role over through user systemd, and say what was done: each
 * replacement, how long it took to be ready, and the units it replaces. A
 * failure rejects; optional roles are rolled only when active. */
let handover = async (options: RestartOptions): Promise<string> => {
  let execute = options.run ?? run
  let exists = options.ready ?? ready
  let now = options.now ?? (() => performance.now())
  let sleep = options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  let command = options.systemctl ?? 'systemctl'
  let call = async (...args: string[]) => {
    let result = await execute(command, ['--user', ...args])
    if (result.code !== 0) {
      throw new Error(
        `${command} ${
          args.join(' ')
        } failed (${result.code}): ${result.stderr.trim()}`,
      )
    }
    return result.stdout
  }
  let roles = options.roles ?? options.processes?.map((p) => ({
    unit: p.unit,
    old: [`${p.unit}@*.service`],
    optional: p.optional,
  })) ?? ROLES
  let deadline = now() + PATIENCE
  // Snapshot every role first: no candidate can be mistaken for an old unit.
  let listed = await call(
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    '--no-pager',
    ...roles.flatMap((r) => r.old),
  )
  let active = listed.split('\n').map((line) => line.trim().split(/\s+/)[0])
    .filter((unit) => unit.endsWith('.service'))
  let replacing = roles.map((r) => ({
    ...r,
    old: active.filter((unit) => r.old.some((p) => matches(p, unit))),
  })).filter((r) => !r.optional || r.old.length)
  let candidates: { unit: string; ready: boolean }[] = []
  let said: string[] = []
  try {
    for (let role of replacing) {
      let instance = crypto.randomUUID()
      let candidate = { unit: `${role.unit}@${instance}.service`, ready: false }
      let file = readyFile(options.runtimeDir, role.unit, instance)
      candidates.push(candidate)
      let began = now()
      await call('--no-block', 'start', candidate.unit)
      while (true) {
        if (now() >= deadline) {
          // Inspect before cleanup: systemd may unload the stopped instance,
          // losing precisely the evidence of whether it ever started.
          let state: string
          try {
            state = await call(
              'show',
              candidate.unit,
              '--property=ActiveState,SubState,Result,Job,InvocationID,MainPID,ExecMainStartTimestamp,ExecMainStatus',
            )
          } catch (error) {
            state = String(error)
          }
          throw new Error(
            `Timed out after ${PATIENCE}ms waiting for ${file}\n${state.trim()}`,
          )
        }
        let found = await exists(file)
        if (found && now() < deadline) break
        await sleep(Math.min(100, Math.max(0, deadline - now())))
      }
      candidate.ready = true
      said.push(
        `${candidate.unit} ready in ${((now() - began) / 1000).toFixed(1)}s` +
          (role.old.length ? `; stopping ${role.old.join(', ')}` : ''),
      )
    }
    let old = replacing.flatMap((r) => r.old)
    if (old.length) await call('--no-block', 'stop', ...old)
    return said.join('\n')
  } catch (error) {
    // A ready replacement survives later failures. Never retire old units
    // until every replacement is ready; a failed start may still have queued
    // a job.
    let errors: unknown[] = [error]
    await Promise.all(
      candidates.filter((c) => !c.ready).map(async (candidate) => {
        try {
          await call('--no-block', 'stop', candidate.unit)
        } catch (cleanup) {
          errors.push(cleanup)
        }
      }),
    )
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Handover and cleanup failed')
    }
    throw error
  }
}
