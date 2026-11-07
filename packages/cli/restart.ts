import * as disk from '@yaks/file/io'
import { command as launchCommand } from '@yaks/process/command'
import * as system from '@yaks/process/system'
import { codeFile, stale as codeStale } from './code.ts'
import { launching } from './release.ts'
import { FLAGS, runtimeSource, runtimeTree } from './runtime.ts'
// Ready-first handover for the box's processes. A role whose running units
// run the code and config a replacement would (./code.ts) keeps them. Every
// other role's replacement is started at once from its unit template and
// waited on until it says it is ready (its readiness file); only once every
// replacement is ready are the old units asked to stop, without waiting for
// them. A worker is ready once its pool and graph are assembled, and its old
// one drains its steps in flight. A web is ready once it is listening: it
// shares its port with the one it replaces (`yak serve --share`), so nothing
// is refused while the old one stops.

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
  /** Why a running unit must be replaced, or undefined when it runs the code
   * and config a replacement would ({@link stale}). */
  stale?: (unit: string) => Promise<string | undefined>
  sleep?: (milliseconds: number) => Promise<void>
  /** Role units (`yak-work`) to hand over even when they run this code, the
   * way to restart one role on purpose. */
  replace?: string[]
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
  { config, replace = [] }: { config?: string; replace?: string[] } = {},
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
    ...replace.flatMap((role) => ['--replace', role]),
  ])
  if (result.code) {
    throw new Error(`Could not queue restart: ${result.stderr.trim()}`)
  }
  return `Restart queued in ${unit}.service; handover and failure reporting continue in the background`
}

/** Queue the handover from the checkout's `yak`, never this process's
 * private copy of it (./runtime.ts): the handover judges each unit against the
 * tree it runs from, so it runs from the code a replacement would. Every door
 * restarts this way, a command and a serving process's tool alike. */
export let queue = async (
  runtimeDir: string,
  { config, replace }: { config?: string; replace?: string[] } = {},
  execute: NonNullable<RestartOptions['run']> = run,
): Promise<string> => {
  let source = (path: string) =>
    runtimeSource(new URL(path, import.meta.url).href)
  let launch = [
    system.execPath(),
    'run',
    ...FLAGS,
    '--config',
    await launching(
      () => disk.makeTempDir({ dir: runtimeDir, prefix: 'yak-restart-' }),
      source('./release.ts'),
    ),
    source('./yak.ts'),
  ]
  return queueRestart(launch, {
    config: config && disk.resolve(config),
    replace,
  }, execute)
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

/** Why `unit` must be replaced: what differs between the code its record
 * says it runs (./code.ts) and this process's tree, or that either can't be
 * said. */
export let stale = async (
  runtimeDir: string,
  unit: string,
): Promise<string | undefined> => {
  let tree = runtimeTree()
  if (!tree) return 'this restart runs from no pinned tree'
  let [, template, instance] = /^(.+)@(.+)\.service$/.exec(unit) ?? []
  if (!instance) return 'no instance'
  let file = codeFile(readyFile(runtimeDir, template, instance))
  let code = await disk.readTextFile(file).then(JSON.parse).catch(() =>
    undefined
  )
  return code ? await codeStale(code, tree) : 'it keeps no code record'
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
    // A later handover may have kept a role this call asks to replace.
    if (last && last.began > asked && !options.replace?.length) {
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

/** Hand every role whose code changed over through user systemd, and say
 * what was done: each replacement, how long it took to be ready, the units it
 * replaces and why, and the units kept. A failure rejects; optional roles are
 * rolled only when active. */
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
  let asked = new Set(options.replace)
  let unknown = [...asked].filter((unit) => !roles.some((r) => r.unit == unit))
  if (unknown.length) {
    throw new Error(
      `No role ${unknown.join(', ')} to replace; the roles are ${
        roles.map((r) => r.unit).join(', ')
      }`,
    )
  }
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
  let running = roles.map((r) => ({
    ...r,
    old: active.filter((unit) => r.old.some((p) => matches(p, unit))),
  })).filter((r) => !r.optional || r.old.length)
  // A role whose every unit runs what a replacement would keeps running: a
  // landing that touched one package interrupts only what loads it.
  let judge = options.stale ??
    ((unit: string) => stale(options.runtimeDir, unit))
  let why = await Promise.all(
    running.map((r) =>
      Promise.all(
        r.old.map((unit) =>
          asked.has(r.unit) ? 'asked to replace' : judge(unit).catch(String)
        ),
      )
    ),
  )
  let replacing = running.filter((r, i) =>
    !r.old.length || why[i].some((w) => w !== undefined)
  )
  let kept = running.filter((r) => !replacing.includes(r))
    .flatMap((r) => r.old.map((unit) => `${unit} runs this code; kept`))
  let reasons = new Map(
    running.flatMap((r, i) =>
      r.old.map((unit, j) => [unit, why[i][j]] as const)
    ),
  )
  // Every replacement starts at once and readies beside the old units, so the
  // handover takes as long as its slowest role, not the sum of them.
  let candidates = replacing.map((role) => {
    let instance = crypto.randomUUID()
    return {
      role,
      unit: `${role.unit}@${instance}.service`,
      file: readyFile(options.runtimeDir, role.unit, instance),
      ready: false,
      took: 0,
    }
  })
  try {
    let began = now()
    if (candidates.length) {
      await call('--no-block', 'start', ...candidates.map((c) => c.unit))
    }
    while (candidates.some((c) => !c.ready)) {
      let waiting = candidates.filter((c) => !c.ready)
      if (now() >= deadline) {
        // Inspect before cleanup: systemd may unload the stopped instance,
        // losing precisely the evidence of whether it ever started.
        let state: string
        try {
          state = await call(
            'show',
            ...waiting.map((c) => c.unit),
            '--property=Id,ActiveState,SubState,Result,Job,InvocationID,MainPID,ExecMainStartTimestamp,ExecMainStatus',
          )
        } catch (error) {
          state = String(error)
        }
        throw new Error(
          `Timed out after ${PATIENCE}ms waiting for ${
            waiting.map((c) => c.file).join(', ')
          }\n${state.trim()}`,
        )
      }
      for (let candidate of waiting) {
        if (await exists(candidate.file) && now() < deadline) {
          candidate.ready = true
          candidate.took = now() - began
        }
      }
      if (candidates.some((c) => !c.ready)) {
        await sleep(Math.min(100, Math.max(0, deadline - now())))
      }
    }
    let old = replacing.flatMap((r) => r.old)
    if (old.length) await call('--no-block', 'stop', ...old)
    return [
      ...candidates.map(({ unit, took, role }) =>
        `${unit} ready in ${(took / 1000).toFixed(1)}s` +
        (role.old.length
          ? `; stopping ${
            role.old.map((u) => reasons.get(u) ? `${u} (${reasons.get(u)})` : u)
              .join(', ')
          }`
          : '')
      ),
      ...kept,
    ].join('\n')
  } catch (error) {
    // A ready replacement survives later failures. Never retire old units
    // until every replacement is ready; a failed start may still have queued
    // a job.
    let errors: unknown[] = [error]
    let unready = candidates.filter((c) => !c.ready).map((c) => c.unit)
    if (unready.length) {
      try {
        await call('--no-block', 'stop', ...unready)
      } catch (cleanup) {
        errors.push(cleanup)
      }
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Handover and cleanup failed')
    }
    throw error
  }
}
