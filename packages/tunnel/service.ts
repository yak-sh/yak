// The machine's end of a tunnel, as a duty: the module a machine's `yak`
// imports at `@yaks/tunnel/service` to keep its tunnel up for as long as the
// process that holds the role is (M-39540: one process at a time runs a
// service).
//
// The connector runs `cloudflared` with the tunnel's token and nothing else:
// the tunnel is configured from the account (./cloudflare.ts), so the machine
// needs no config file, no open port and no public address. The token rides
// in the connector's environment (`TUNNEL_TOKEN`), never its arguments, so no
// process listing shows it. A connector that exits is started again after a
// pause that grows while it keeps failing; the role ending stops it.
//
// The token is a secret the config names (`{"secret": "TUNNEL_TOKEN"}`), read
// from the vault by whoever composed the host. A config with no token has
// nothing to run, and the duty ends at once: a machine whose tunnel something
// else already runs leaves it out.

/** What a config file can set for this plugin. */
export type Options = {
  /** the tunnel's token; with none, there is nothing to run */
  token?: string
  /** the `cloudflared` to run (default: the one on PATH) */
  cloudflared?: string
  /** the first pause, in ms, before a failed connector is started again */
  pause?: number
  /** how the connector is started; a test passes its own */
  spawn?: Spawn
}

/** A started connector: when it ends, and how to end it. */
export type Running = {
  status: Promise<{ code: number }>
  kill: () => void
}

/** Start `cmd` with `args` and `env` added to the environment. */
export type Spawn = (
  cmd: string,
  args: string[],
  env: Record<string, string>,
) => Running

/** What the connector is started with: run the account-configured tunnel,
 * saying only warnings and failures. */
export let ARGS = ['tunnel', '--no-autoupdate', '--loglevel', 'warn', 'run']

/** The most the pause before a restart grows to. */
export let MOST = 60_000

/** `cloudflared` as a child of this process, its warnings on our stderr. */
export let spawned: Spawn = (cmd, args, env) => {
  let child = new Deno.Command(cmd, {
    args,
    env,
    stdin: 'null',
    stdout: 'null',
    stderr: 'inherit',
  }).spawn()
  return {
    status: child.status,
    kill: () => {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
    },
  }
}

// A pause the signal cuts short.
let rest = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    let t = setTimeout(done, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      done()
    }, { once: true })
  })

// The connector, kept up until the signal aborts.
let connector = async (options: Options, signal: AbortSignal) => {
  let { token, cloudflared = 'cloudflared', spawn = spawned, pause = 1_000 } =
    options
  if (!token) return
  let wait = pause
  while (!signal.aborted) {
    let started = Date.now()
    let run = spawn(cloudflared, ARGS, { TUNNEL_TOKEN: token })
    let stop = () => run.kill()
    signal.addEventListener('abort', stop, { once: true })
    let { code } = await run.status
    signal.removeEventListener('abort', stop)
    if (signal.aborted) return
    console.error(`cloudflared exited ${code}; starting it again`)
    // A connector that stayed up a while failed for a new reason: start the
    // pause over rather than make it wait out an old backoff.
    if (Date.now() - started > MOST) wait = pause
    await rest(wait, signal)
    wait = Math.min(wait * 2, MOST)
  }
}

/** Keep the tunnel up until the signal aborts; an already-aborted signal
 * starts nothing. */
export let service = (
  _host: unknown,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => connector(options, signal)
