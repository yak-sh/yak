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
  runtimeDir: string
  roles?: Role[]
  systemctl?: string
  run?: (
    command: string,
    args: string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>
  ready?: (path: string) => Promise<boolean>
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
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

/** How long a replacement has to say it is ready (ms). */
export let PATIENCE = 15_000

let run: NonNullable<RestartOptions['run']> = async (command, args) => {
  let result = await new Deno.Command(command, {
    args,
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

let ready = async (path: string) => {
  try {
    return (await Deno.stat(path)).isFile
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

let matches = (pattern: string, unit: string) => {
  let [before, after] = pattern.split('*')
  return after == null
    ? unit == before
    : unit.startsWith(before) && unit.endsWith(after)
}

/** Hand every role over through user systemd, and say what was done: each
 * replacement, how long it took to be ready, and the units it replaces. A
 * failure rejects; optional roles are rolled only when active. */
export let restart = async (options: RestartOptions): Promise<string> => {
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
  let roles = options.roles ?? ROLES
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
      let file = `${
        options.runtimeDir.replace(/\/$/, '')
      }/${role.unit}-${instance}.ready`
      candidates.push(candidate)
      let began = now()
      await call('--no-block', 'start', candidate.unit)
      let deadline = began + PATIENCE
      while (true) {
        if (now() >= deadline) {
          throw new Error(`Timed out after ${PATIENCE}ms waiting for ${file}`)
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
    for (let candidate of candidates.filter((c) => !c.ready)) {
      try {
        await call('--no-block', 'stop', candidate.unit)
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
