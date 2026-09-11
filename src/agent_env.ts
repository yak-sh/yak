// The allowlisted environment shared by process-backed and hosted agents.
// Agents receive the host toolchain and their Tasks identity without copying
// service or provider secrets from tasksd's environment into child processes.
//
// The toolchain PATH is a tracked deployment contract, not an inheritance:
// etc/tasksd.service.d/path.conf is the single source of truth, read both by
// systemd (to set tasksd's own PATH) and here (to build every child's PATH).
// Deriving from the file rather than from tasksd's live env means a stale or
// hand-edited running unit still hands agents the tracked PATH — a missing
// provider dir is exit 127 for the agent (M-17876), and this is what prevents
// it. See T-16728.
//
// The module cache is pinned the same way, and for the same reason: a value
// every child gets beats a rule every agent is asked to remember.

// Deno resolves its module cache under HOME, so a child handed a redirected
// home — `HOME=$(mktemp -d) deno …`, the probe-isolation idiom — downloads a
// whole cache of its own, ~800 MB including the workerd binary, and leaves it
// there. 142 such throwaway homes in twelve hours ate 46.6 GB and filled the
// disk twice (T-37394). The docs already asked agents to export DENO_DIR
// first; guidance is not enforcement (M-4066), so the cache is pinned in the
// environment instead. Resolved ONCE from the environment this process started
// in, before anything can move HOME, and exported to every child — where a
// `HOME=` prefix on the command line cannot reach it, which is the point.
export let denoCache = (() => {
  let configured = Deno.env.get('DENO_DIR')
  if (configured) return configured
  let home = Deno.env.get('HOME')
  if (Deno.build.os == 'darwin') return `${home}/Library/Caches/deno`
  if (Deno.build.os == 'windows') return `${Deno.env.get('LOCALAPPDATA')}\\deno`
  return `${Deno.env.get('XDG_CACHE_HOME') ?? `${home}/.cache`}/deno`
})()

// The tracked drop-in, resolved from this module so CWD never matters.
let CONTRACT = new URL('../etc/tasksd.service.d/path.conf', import.meta.url)

// The PATH line from the contract, cached — the file is static and tracked.
let contract: string | undefined
let readContract = () => {
  if (contract == null) {
    let text = Deno.readTextFileSync(CONTRACT)
    let line = text.split('\n').find((l) => l.startsWith('Environment=PATH='))
    if (!line) throw new Error(`no Environment=PATH= in ${CONTRACT.pathname}`)
    contract = line.slice('Environment=PATH='.length).trim()
  }
  return contract
}

// The deterministic child PATH: the tracked contract with %h expanded to the
// agent's home, the task CLI (~/.deno/bin) led and every entry de-duped. With
// no home the home-relative entries drop out rather than resolving to `/…`.
export let childPath = (home: string) => {
  let bin = home ? `${home}/.deno/bin` : ''
  let parts = readContract()
    .split(':')
    .map((part) => (home ? part.replaceAll('%h', home) : part))
    .filter((part) => part && !part.includes('%h') && part != bin)
  return [bin, ...parts].filter(Boolean).join(':')
}

export let childEnv = (
  session: string | undefined,
  tree: string,
) => {
  let home = Deno.env.get('HOME') ?? ''
  return {
    PATH: childPath(home),
    HOME: home,
    DENO_DIR: denoCache,
    TERM: Deno.env.get('TERM') ?? 'dumb',
    ...(session ? { TASKS_SESSION: session } : {}),
    TASKS_TREE: tree,
    ...(Deno.env.get('TASKS_HOST')
      ? { TASKS_HOST: Deno.env.get('TASKS_HOST')! }
      : {}),
  }
}
