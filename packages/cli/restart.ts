// Ready-first handover for the box's independent duty roles. Each worker uses
// its own template and graph; serving units drain separately after all are ready.

export type Worker = {
  unit: string
  old: string[]
  optional?: boolean
}

export type RestartOptions = {
  runtimeDir: string
  workers?: Worker[]
  web?: string[]
  systemctl?: string
  run?: (
    command: string,
    args: string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>
  ready?: (path: string) => Promise<boolean>
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

let workers: Worker[] = [
  { unit: 'yak-work', old: ['yak-work@*.service'] },
  {
    unit: 'yak-tracker',
    old: ['yak-tracker.service', 'yak-tracker@*.service'],
    optional: true,
  },
]
let web = ['yak.service', 'yak-tracker-web.service']

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

/** Queue a user-systemd handover, returning the primary candidate or rejecting.
 * Optional roles are rolled only when active; discovery errors still reject. */
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
  let roles = options.workers ?? workers
  let serving = options.web ?? web
  // Snapshot every role first: no candidate can be mistaken for an old worker.
  let listed = await call(
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    '--no-pager',
    ...roles.flatMap((r) => r.old),
    ...serving,
  )
  let active = listed.split('\n').map((line) => line.trim().split(/\s+/)[0])
    .filter((unit) => unit.endsWith('.service'))
  let replacing = roles.map((r) => ({
    ...r,
    old: active.filter((unit) => r.old.some((p) => matches(p, unit))),
  })).filter((r) => !r.optional || r.old.length)
  let candidates: { unit: string; ready: boolean }[] = []
  try {
    for (let role of replacing) {
      let instance = crypto.randomUUID()
      let candidate = { unit: `${role.unit}@${instance}.service`, ready: false }
      let file = `${
        options.runtimeDir.replace(/\/$/, '')
      }/${role.unit}-${instance}.ready`
      candidates.push(candidate)
      await call('--no-block', 'start', candidate.unit)
      let deadline = now() + 15_000
      while (true) {
        if (now() >= deadline) {
          throw new Error(`Timed out after 15000ms waiting for ${file}`)
        }
        let found = await exists(file)
        if (found && now() < deadline) break
        await sleep(Math.min(100, Math.max(0, deadline - now())))
      }
      candidate.ready = true
    }
    let old = replacing.flatMap((r) => r.old)
    if (old.length) await call('--no-block', 'stop', ...old)
    let webs = serving.filter((unit) => active.includes(unit))
    if (webs.length) await call('--no-block', 'restart', ...webs)
    return candidates[0]?.unit ?? ''
  } catch (error) {
    // A ready pool survives later failures. Never retire old roles until every
    // replacement is ready; a failed start may still have queued a job.
    let errors: unknown[] = [error]
    for (let candidate of candidates.filter((c) => !c.ready)) {
      try {
        await call('--no-block', 'stop', candidate.unit)
      } catch (cleanup) {
        errors.push(cleanup)
      }
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Worker handover and cleanup failed')
    }
    throw error
  }
}
