import * as disk from '@yaks/file/io'
import { command as launchCommand } from '@yaks/process/command'
import * as system from '@yaks/process/system'
import { codeFile, stale as codeStale } from './code.ts'
import { launching } from './release.ts'
import { FLAGS, runtimeSource, runtimeTree } from './runtime.ts'
// Ready-first handover for the box's processes, queued from the checkout's
// `yak` ({@link queue}). A role whose running units run the code and config a
// replacement would (./code.ts) keeps them. Every
// other role warms its replacement from its unit template and asks the old
// units of that role to stop after the readiness file arrives. One role warms
// at a time, so five cold starts cannot compete with the serving box. A worker
// is ready once its pool and graph are assembled, and its old
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
  run?: Run
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

type Run = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>

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

/** How long the supervised handover waits for its replacements to be ready,
 * from when they start, without holding its caller. */
export let PATIENCE = 120_000

/** One systemctl or systemd-run call only queues a job, but on a box busy with
 * landings and restarts that alone can take seconds; a tighter bound aborted
 * a handover halfway, leaving its ready replacements beside the old units. */
let CALL = 30_000

let run: Run = async (command, args) => {
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
  execute: Run = run,
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
  execute: Run = run,
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
  let instanceUnit = instanceOf(unit)
  if (!instanceUnit) return 'no instance'
  let [template, instance] = instanceUnit
  let file = codeFile(readyFile(runtimeDir, template, instance))
  let code = await disk.readTextFile(file).then(JSON.parse).catch(() =>
    undefined
  )
  return code ? await codeStale(code, tree) : 'it keeps no code record'
}

let listedUnits = (listed: string): string[] =>
  listed.split('\n').map((line) => line.trim().split(/\s+/)[0])
    .filter((unit) => unit.endsWith('.service'))

/** The template and instance of a unit such as `yak-web@<id>.service`. */
export let instanceOf = (unit: string): [string, string] | undefined => {
  let found = unit.match(/^(.+)@(.+)\.service$/)
  return found ? [found[1], found[2]] : undefined
}

/** How many other active instances of `unit`'s template are ready, by user
 * systemd and the ready files in `runtimeDir`. Undefined when that is no
 * question: a unit that is no template instance, or a manager that is
 * stopping, when every unit stops at once. */
export let others = async (
  unit: string,
  runtimeDir: string,
  execute: (
    command: string,
    args: string[],
  ) => Promise<{ code: number; stdout: string }> = run,
  exists: (path: string) => Promise<boolean> = ready,
  command = 'systemctl',
): Promise<number | undefined> => {
  let template = instanceOf(unit)?.[0]
  if (!template) return
  let state = await execute(command, ['--user', 'is-system-running'])
  if (state.stdout.trim() == 'stopping') return
  let listed = await execute(command, [
    '--user',
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    '--no-pager',
    `${template}@*.service`,
  ])
  if (listed.code) throw new Error(`systemctl could not list ${template}@`)
  let instances = listedUnits(listed.stdout)
    .filter((peer) => peer != unit)
    .flatMap((peer) => instanceOf(peer)?.slice(1) ?? [])
  let found = await Promise.all(
    instances.map((i) => exists(readyFile(runtimeDir, template, i))),
  )
  return found.filter(Boolean).length
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

let holdRestart = (options: RestartOptions): Promise<Held> =>
  (options.lock ?? lock)(
    `${options.runtimeDir.replace(/\/$/, '')}/yak-restart.lock`,
  )

/** Serialize the snapshot and handover across CLI processes. A second caller
 * waits for the running handover; if one began after it was called, that one
 * already started its code, so it coalesces into it instead of rolling again. */
export let restart = async (options: RestartOptions): Promise<string> => {
  let clock = options.clock ??
    (() => performance.timeOrigin + performance.now())
  let asked = clock()
  let held = await holdRestart(options)
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

let systemctl = (options: RestartOptions) => {
  let command = options.systemctl ?? 'systemctl'
  return async (...args: string[]) => {
    let result = await (options.run ?? run)(command, ['--user', ...args])
    if (result.code !== 0) {
      throw new Error(
        `${command} ${
          args.join(' ')
        } failed (${result.code}): ${result.stderr.trim()}`,
      )
    }
    return result.stdout
  }
}

let warm = async (
  template: string,
  options: RestartOptions,
): Promise<{ unit: string; took: number }> => {
  let call = systemctl(options)
  let exists = options.ready ?? ready
  let now = options.now ?? (() => performance.now())
  let sleep = options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  let instance = crypto.randomUUID()
  let unit = `${template}@${instance}.service`
  let file = readyFile(options.runtimeDir, template, instance)
  let began = now()
  let deadline = began + PATIENCE
  try {
    await call('--no-block', 'start', unit)
    while (now() < deadline) {
      if (await exists(file) && now() < deadline) {
        return { unit, took: now() - began }
      }
      await sleep(Math.min(100, Math.max(0, deadline - now())))
    }
    // Read the unit state while systemd still has the instance.
    let state = await call(
      'show',
      unit,
      '--property=Id,ActiveState,SubState,Result,Job,InvocationID,MainPID,ExecMainStartTimestamp,ExecMainStatus',
    ).catch(String)
    throw new Error(
      `Timed out after ${PATIENCE}ms waiting for ${file}\n${state.trim()}`,
    )
  } catch (error) {
    try {
      await call('--no-block', 'stop', unit)
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Handover and cleanup failed',
      )
    }
    throw error
  }
}

/** Keep a supervised role covered during a systemd stop. The stop job sends
 * TERM after ExecStop returns. An in-place restart writes a newer ready file
 * when it comes back, and the peer then drains (./lifetime.ts). */
export let beforeStop = async (
  unit: string,
  options: RestartOptions,
): Promise<string | undefined> => {
  let target = instanceOf(unit)
  if (!target) return
  let [template, instance] = target
  let { runtimeDir, run, ready: exists = ready, systemctl } = options
  if (!await exists(readyFile(runtimeDir, template, instance))) return
  let uncovered = async () =>
    await others(unit, runtimeDir, run, exists, systemctl) === 0
  if (!await uncovered()) return
  let held = await holdRestart(options)
  try {
    if (!await uncovered()) return
    let peer = await warm(template, options)
    return `${peer.unit} ready in ${
      (peer.took / 1000).toFixed(1)
    }s; handing off ${unit}`
  } finally {
    held.close()
  }
}

/** Hand every role whose code changed over through user systemd, and say
 * what was done: each replacement, how long it took to be ready, the units it
 * replaces and why, and the units kept. A failure rejects; optional roles are
 * rolled only when active. */
let handover = async (options: RestartOptions): Promise<string> => {
  let call = systemctl(options)
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
  // Snapshot every role first: no candidate can be mistaken for an old unit.
  let listed = await call(
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    '--no-pager',
    ...roles.flatMap((r) => r.old),
  )
  let active = listedUnits(listed)
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
  let roll = async (role: Role): Promise<string> => {
    let { unit, took } = await warm(role.unit, options)
    if (role.old.length) await call('--no-block', 'stop', ...role.old)
    return `${unit} ready in ${(took / 1000).toFixed(1)}s` +
      (role.old.length
        ? `; stopping ${
          role.old.map((u) => reasons.get(u) ? `${u} (${reasons.get(u)})` : u)
            .join(', ')
        }`
        : '')
  }
  let summaries: string[] = [], errors: unknown[] = []
  for (let role of replacing) {
    try {
      summaries.push(await roll(role))
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length == 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, 'Handover failed')
  return [...summaries, ...kept].join('\n')
}
