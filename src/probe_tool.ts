// The warm probe path: boot a scratch-graph server, drive it, reap it BY PID —
// so an agent never hand-rolls `pkill -f src/server.ts` and kills the live 5173
// server (or a peer's probe) instead. That has recurred repeatedly despite the
// CLAUDE.md warning, because a memory can't stop a keystroke and `pkill -f`
// matches EVERY server that runs the same file, live one included (T-14610).
//
// This owns a probe's whole lifecycle. `up` copies the live graph into a scratch
// db under a `scratchpad/` path (so even a forgotten probe is collected by the
// probes.ts sweep, the safety net), boots src/server.ts on a free port detached,
// and REGISTERS the pid. `down` kills ONLY that recorded pid — and only while it
// is still a `deno` process, so a reused pid is never signalled and the live
// server (a different, long-held pid) can never be the target. Pid-only is the
// ONE door; there is no pattern to get wrong.

import { DatabaseSync } from './sqlite.ts'
import { commOf } from './proc.ts'

let root = new URL('..', import.meta.url).pathname
let liveDb = () =>
  Deno.env.get('DB_PATH') ?? `${Deno.env.get('HOME')}/.tasks/tasks.db`

// One per-user directory holds the registry, so `ls`/`down` find a probe an
// earlier `up` left running across separate invocations.
export let registryDir = () => {
  let base = Deno.env.get('XDG_RUNTIME_DIR') || Deno.env.get('TMPDIR') || '/tmp'
  let dir = `${base}/tasks-probes`
  Deno.mkdirSync(dir, { recursive: true })
  return dir
}

export type Probe = {
  port: number
  pid: number
  url: string
  db: string
  scratch: string
  born: number
}

let entryPath = (port: number) => `${registryDir()}/${port}.json`

export let enroll = (p: Probe) =>
  Deno.writeTextFileSync(entryPath(p.port), JSON.stringify(p))

export let forget = (port: number) => {
  try {
    Deno.removeSync(entryPath(port))
  } catch { /* already gone */ }
}

export let list = (): Probe[] => {
  let out: Probe[] = []
  for (let e of Deno.readDirSync(registryDir())) {
    if (!e.name.endsWith('.json')) continue
    try {
      out.push(JSON.parse(Deno.readTextFileSync(`${registryDir()}/${e.name}`)))
    } catch { /* a torn write is not a probe */ }
  }
  return out.sort((a, b) => a.port - b.port)
}

let pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

// A recorded pid is OUR server only while it is still a live `deno` process.
// This is the pid-reuse guard AND the whole safety of the reap: the live server
// holds a different, long-lived pid, so its pid is never a probe's recorded one.
export let ours = (pid: number, comm = commOf) => comm(pid) == 'deno'

// Kill exactly one pid: TERM, wait for it to leave, KILL what ignores it —
// never a pattern, never a peer. A pid that is not (or no longer) our deno is
// left untouched and reported gone, so a reused pid is safe.
export let stop = async (
  pid: number,
  comm = commOf,
  kill = Deno.kill,
  rest = pause,
): Promise<'killed' | 'gone'> => {
  if (!ours(pid, comm)) return 'gone'
  try {
    kill(pid, 'SIGTERM')
  } catch { /* already gone */ }
  for (let n = 0; n < 40 && ours(pid, comm); n++) await rest(50)
  if (ours(pid, comm)) {
    try {
      kill(pid, 'SIGKILL')
    } catch { /* raced us to exit */ }
  }
  return 'killed'
}

// A consistent snapshot of the live graph into the scratch db: VACUUM INTO
// reads the source (opened read-only, so it can never write the live file) and
// writes a fresh, integral copy — the same mechanism bin/backup trusts.
export let copyGraph = (from: string, to: string) => {
  let db = new DatabaseSync(from, { readOnly: true })
  try {
    db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`)
  } finally {
    db.close()
  }
}

let freePort = () => {
  let l = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (l.addr as Deno.NetAddr).port
  l.close()
  return port
}

let ready = async (url: string, within = 15_000) => {
  for (let waited = 0; waited < within; waited += 100) {
    try {
      if ((await fetch(`${url}/snapshot`)).ok) return true
    } catch { /* not up yet */ }
    await pause(100)
  }
  return false
}

let rmDir = async (dir: string) => {
  for (let n = 0; n < 5; n++) {
    try {
      await Deno.remove(dir, { recursive: true })
      return true
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return true
      await pause(100)
    }
  }
  return false
}

let up = async (args: string[]) => {
  let want = args[args.indexOf('--port') + 1]
  let port = args.includes('--port') ? Number(want) : freePort()
  let fresh = args.includes('--fresh')
  // The `scratchpad/` segment is load-bearing: it is what makes the sweep see
  // this server as a probe and collect it if `down` is never called.
  let scratch = await Deno.makeTempDir({ prefix: 'tasks-probe-' })
  let graphDir = `${scratch}/scratchpad`
  Deno.mkdirSync(graphDir)
  let db = `${graphDir}/tasks.db`
  if (!fresh) {
    try {
      copyGraph(liveDb(), db)
    } catch (e) {
      await rmDir(scratch)
      console.error(
        `probe: could not copy ${liveDb()} — ${(e as Error).message}`,
      )
      Deno.exit(1)
    }
  }
  let log = `${scratch}/server.log`
  // `exec` replaces the shell with deno, so the pid we capture IS the server's
  // (comm 'deno') — the pid `stop` later verifies before it signals anything.
  let child = new Deno.Command('sh', {
    args: [
      '-c',
      `exec deno run -A --unstable-net --unstable-worker-options ` +
      `'${root}src/server.ts' >> '${log}' 2>&1`,
    ],
    env: { ...Deno.env.toObject(), PORT: String(port), DB_PATH: db },
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn()
  let url = `http://127.0.0.1:${port}`
  if (!await ready(url)) {
    try {
      child.kill('SIGKILL')
    } catch { /* already dead */ }
    let tail = (await Deno.readTextFile(log).catch(() => '')).split('\n')
      .slice(-12).join('\n')
    await rmDir(scratch)
    console.error(
      `probe: server on ${port} never answered${tail ? `\n${tail}` : ''}`,
    )
    Deno.exit(1)
  }
  // Detach: the probe outlives this `up` so the agent can drive it across tool
  // calls; the registry + sweep are how it is reaped, not this process.
  child.unref()
  let probe: Probe = {
    port,
    pid: child.pid,
    url,
    db,
    scratch,
    born: Date.now(),
  }
  enroll(probe)
  console.log(
    `probe up  ${url}  pid ${child.pid}  ${
      fresh ? 'fresh graph' : 'copy of live'
    }`,
  )
  console.log(`  db  ${db}`)
  console.log(`  reap  bin/probe down ${port}`)
}

let age = (born: number) => `${Math.round((Date.now() - born) / 60_000)}m`

let ls = () => {
  let probes = list()
  if (!probes.length) return console.log('no probes')
  for (let p of probes) {
    let state = ours(p.pid) ? 'up  ' : 'dead'
    console.log(`${state}  ${p.url}  pid ${p.pid}  ${age(p.born)}  ${p.db}`)
  }
}

let down = async (args: string[]) => {
  let targets = args.includes('--all')
    ? list()
    : list().filter((p) => args.includes(String(p.port)))
  if (!targets.length) {
    console.error('probe: nothing to reap (bin/probe ls)')
    Deno.exit(1)
  }
  for (let p of targets) {
    let how = await stop(p.pid)
    let swept = await rmDir(p.scratch)
    forget(p.port)
    console.log(
      `probe down  ${p.url}  pid ${p.pid} ${how}` +
        (swept ? '' : `  — scratch NOT removed: ${p.scratch}`),
    )
    if (!swept) Deno.exitCode = 1
  }
}

let usage = () => {
  console.log(
    `bin/probe — a scratch-graph server you reap by pid, never by pattern\n\n` +
      `  bin/probe up [--port N] [--fresh]   boot one (copy of live unless --fresh)\n` +
      `  bin/probe ls                        list running probes\n` +
      `  bin/probe down <port> | --all       reap by pid + remove its scratch db`,
  )
}

export let main = (args = Deno.args) => {
  let [verb, ...rest] = args
  if (verb == 'up') return up(rest)
  if (verb == 'ls') return ls()
  if (verb == 'down') return down(rest)
  usage()
  if (verb) Deno.exitCode = 1
}
