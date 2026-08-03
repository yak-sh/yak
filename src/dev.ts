// The development and deployed server supervisor. Successors bind beside their
// predecessors, announce when boot is complete, then let the predecessor drain;
// the public port therefore always has a ready listener during source deploys.
import { serverFile } from './reload.ts'

let src = new URL('.', import.meta.url).pathname
let deno = Deno.execPath()
let args = [
  'run',
  '-A',
  '--unstable-net',
  '--unstable-worker-options',
  'src/server.ts',
]

// A SUCCESSOR — and only a successor — may bind an address that is already
// serving; bind.ts refuses everyone else, so a second `deno task dev` against
// the live port is refused rather than quietly doubling it. The first boot
// and the relaunch after a death both expect an empty address, so neither
// asks.
let succeeding = [...args, '--join']

let wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

let signal = async (listener: Deno.TcpListener) => {
  using conn = await listener.accept()
  let buf = new Uint8Array(1)
  let n = await conn.read(buf)
  if (n != 1 || buf[0] != 1) {
    throw new Error('server sent a bad ready signal')
  }
}

// Spawns the child with `--ready=<port>` appended and resolves once it has
// dialed that port back. The port rides argv so the address dies with the
// child; in the environment it would outlive this supervisor in every
// descendant shell.
export let launch = async (
  path = deno,
  run = args,
) => {
  using listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (listener.addr as Deno.NetAddr).port
  let timer: ReturnType<typeof setTimeout> | undefined
  let late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('server did not become ready in 30s')),
      30_000,
    )
  })
  let child = new Deno.Command(path, {
    args: [...run, `--ready=${port}`],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()
  try {
    await Promise.race([
      signal(listener),
      late,
      child.status.then((status) => {
        throw new Error(`server exited before ready (${status.code})`)
      }),
    ])
    return child
  } catch (e) {
    try {
      child.kill('SIGTERM')
    } catch {
      // It already said why it could not start.
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// Condemned (we are retiring it) and departed (its status settled). A child
// can be both; the pair is what tells a death we caused from one we must heal.
let stopping = new WeakSet<Deno.ChildProcess>()
let dead = new WeakSet<Deno.ChildProcess>()

// The server this supervisor is answerable for.
let current: Deno.ChildProcess | undefined

// Every mint and retire runs here, one at a time. A crash-relaunch and an
// edit-swap both replace `current`, and interleaved they lose a handle — the
// orphan keeps the port under reusePort, so the address answers from a server
// nobody can stop or reload.
let lock: Promise<unknown> = Promise.resolve()
let serial = <T>(work: () => Promise<T>): Promise<T> => {
  let done = lock.then(work, work)
  lock = done.catch(() => {})
  return done
}

// Backoff for a successor that will not boot: climbs while boots keep
// failing, resets on one that stands up. A bad commit should idle the box,
// not spin it.
const RETRY = [0, 1_000, 2_000, 5_000, 10_000, 30_000]

// A supervisor ABSORBS its child's death; it never escalates one. Exiting
// here hands the problem to systemd, and `Restart=always` mass-kills this
// unit's cgroup — where the operator tmux tree lives — so a crash we could
// heal in a second costs every operator mid-turn instead (T-11139). There is
// no failure a child can have that the supervisor improves by dying too.
let revive = async (departed: Deno.ChildProcess) => {
  if (current != departed) return // a swap already replaced it
  for (let n = 0;; n++) {
    let ms = RETRY[Math.min(n, RETRY.length - 1)]
    if (ms) await wait(ms)
    try {
      current = watch(await launch())
      return
    } catch (e) {
      console.error('server relaunch failed —', e)
    }
  }
}

let watch = (child: Deno.ChildProcess) => {
  child.status.then((status) => {
    dead.add(child)
    if (stopping.has(child)) return
    console.error(`server stopped unexpectedly (${status.code}) — relaunching`)
    serial(() => revive(child))
  })
  return child
}

let stop = async (child: Deno.ChildProcess) => {
  stopping.add(child)
  try {
    child.kill('SIGTERM')
  } catch {
    // A process that already left is drained.
  }
  await child.status
}

// Condemn the predecessor BEFORE the successor boots. It stays on the port
// and keeps serving, but it is already being replaced — and the successor's
// boot runs migrations against the graph they briefly share, so old code
// meeting a schema that moved under it is expected, not news. Left until
// after `launch()` resolved, that window classified a doomed process's death
// as unexpected and took the supervisor down with it (T-11139).
let swap = async () => {
  let old = current!
  stopping.add(old)
  try {
    current = watch(await launch(deno, succeeding))
    await stop(old)
  } catch (e) {
    console.error('server handoff failed —', e)
    // No successor, so the predecessor is still ours: lift the condemnation.
    stopping.delete(old)
    current = old
    // Unless the reprieve came too late — nothing watches a child whose
    // status already settled, so heal here or sit holding a dead handle.
    if (dead.has(old)) await revive(old)
  }
}

let supervise = async () => {
  current = watch(await launch())
  let pending = false
  let swapping = false

  let swaps = async () => {
    swapping = true
    while (pending) {
      pending = false
      await wait(50)
      if (!pending) await serial(swap)
    }
    swapping = false
  }

  for await (let event of Deno.watchFs(src)) {
    if (!event.paths.some(serverFile)) continue
    pending = true
    if (!swapping) swaps()
  }
}

if (import.meta.main) await supervise()
