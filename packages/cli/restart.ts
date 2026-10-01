/// <reference lib="deno.ns" />
// A systemd worker handover: prove a unique candidate ready before queuing
// retirement of the old workers and the serving process. No shutdown is awaited.

export type RestartOptions = {
  runtimeDir: string
  systemctl?: string
  run?: (
    command: string,
    args: string[],
  ) => Promise<{ code: number; stdout: string; stderr: string }>
  ready?: (path: string) => Promise<boolean>
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

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

/** Queue a user-systemd handover, returning the candidate unit or rejecting. */
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

  // Snapshot first: the new unit must never be mistaken for an old worker.
  let listed = await call(
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    '--no-pager',
    'yak-work@*.service',
  )
  let old = listed.split('\n').map((line) => line.trim().split(/\s+/)[0])
    .filter((unit) => /^yak-work@[^\s]+\.service$/.test(unit))
  let instance = crypto.randomUUID()
  let candidate = `yak-work@${instance}.service`
  let file = `${
    options.runtimeDir.replace(/\/$/, '')
  }/yak-work-${instance}.ready`
  try {
    await call('--no-block', 'start', candidate)
    let deadline = now() + 15_000
    while (true) {
      if (now() >= deadline) {
        throw new Error(`Timed out after 15000ms waiting for ${file}`)
      }
      let found = await exists(file)
      if (found && now() < deadline) break
      await sleep(Math.min(100, Math.max(0, deadline - now())))
    }
    if (old.length) await call('--no-block', 'stop', ...old)
    await call('--no-block', 'restart', 'yak.service')
    return candidate
  } catch (error) {
    // Even a failed start may have queued a job. Recovery touches only this unit.
    try {
      await call('--no-block', 'stop', candidate)
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Worker handover and cleanup failed',
      )
    }
    throw error
  }
}
