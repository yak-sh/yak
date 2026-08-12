// The allowlisted environment shared by process-backed and hosted agents.
// Agents receive the host toolchain and their Tasks identity without copying
// service or provider secrets from tasksd's environment into child processes.

export let childPath = (home: string, path: string) => {
  if (!home) return path
  let bin = `${home}/.deno/bin`
  let rest = path.split(':').filter((part) => part != bin).join(':')
  return rest ? `${bin}:${rest}` : bin
}

export let childEnv = (
  session: string | undefined,
  tree: string,
  role?: string,
) => {
  let home = Deno.env.get('HOME') ?? ''
  return {
    PATH: childPath(home, Deno.env.get('PATH') ?? ''),
    HOME: home,
    TERM: Deno.env.get('TERM') ?? 'dumb',
    ...(session ? { TASKS_SESSION: session } : {}),
    TASKS_TREE: tree,
    ...(role ? { TASKS_ROLE: role } : {}),
    ...(Deno.env.get('TASKS_HOST')
      ? { TASKS_HOST: Deno.env.get('TASKS_HOST')! }
      : {}),
  }
}
