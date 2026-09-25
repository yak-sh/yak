// The machine's end of a link, as a duty: the module a machine's `yak`
// imports at `@yaks/tunnel/service` to keep its tunnel up and its door open
// for as long as the process that holds the role is (M-39540: one process at
// a time runs a service). Two parts, each run where the config names it.
//
// The connector runs `cloudflared` with the tunnel's token and nothing else:
// the tunnel is configured from the account (./cloudflare.ts), so the machine
// needs no config file, no open port and no public address. The token rides
// in the connector's environment (`TUNNEL_TOKEN`), never its arguments, so no
// process listing shows it. A connector that exits is started again after a
// pause that grows while it keeps failing; the role ending stops it.
//
// The door (./link.ts `link`) listens on `127.0.0.1` at `port`, the port the
// link's VPC Service names, and passes on to this machine's own server only a
// request carrying the link's secret, at a path the config opened. It reads
// the secret on every request, so one written to the vault after it started
// is the one it checks.
//
// The token and the secret are secrets the config names
// (`{"secret": "TUNNEL_TOKEN"}`), read from the vault by whoever composed the
// host. A config that names neither a token nor a port has nothing to run, and
// the duty ends at once.
import { link } from './link.ts'

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
  /** the link's secret, the one its gateway adds to every request */
  secret?: string
  /** the port the link's door listens on at `127.0.0.1`: the one its VPC
   * Service names, never the server's own */
  port?: number
  /** the paths the link answers, as URLPattern pathnames; none opens
   * nothing */
  routes?: string[]
  /** the server a request the link admits goes on to, as an origin
   * (default `http://127.0.0.1:` and the config's own `port`) */
  to?: string
}

/** What the duty reads of the host it runs in: where its server listens. */
type Host = { config?: { port?: number } } | null | undefined

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

// The door, open until the signal aborts.
let door = async (host: Host, options: Options, signal: AbortSignal) => {
  if (!options.port || signal.aborted) return
  let at = host?.config?.port
  let to = options.to ?? (at ? `http://127.0.0.1:${at}` : undefined)
  if (!to) {
    console.error('the link has no server to pass requests to: set `to`')
    return
  }
  let server = Deno.serve(
    { hostname: '127.0.0.1', port: options.port, signal, onListen: () => {} },
    link(options, to),
  )
  await server.finished
}

/** Keep the tunnel up and the door open until the signal aborts; an
 * already-aborted signal starts nothing. */
export let service = async (
  host: Host,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  await Promise.all([connector(options, signal), door(host, options, signal)])
}
