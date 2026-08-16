// The development and deployed server supervisor. Successors bind beside their
// predecessors, announce when boot is complete, then let the predecessor drain;
// the public port therefore always has a ready listener during source deploys.
import { devFile, serverFile } from './reload.ts'

let src = new URL('.', import.meta.url).pathname
let deno = Deno.execPath()

// Where a successor's death reason is kept. Mirrors sessions.ts logsDir() (its
// LOGS_DIR lever included), replicated rather than imported so the supervisor
// stays off the served module graph. A managed run's stdout file IS its log;
// the supervisor's children get the same treatment, one shared append log.
let logsDir = () =>
  Deno.env.get('LOGS_DIR') ?? `${Deno.env.get('HOME')}/.tasks/dev`

// Pump a child's stderr to a durable file AND relay it to ours. `inherit` sent
// every diagnostic to whatever stdio the supervisor had — on the live box a
// socket owned by a shell long gone — so four handoff deaths left no reason on
// disk (T-14308). Both writes are best-effort and this never rejects: logging
// the failure must not become one. Returns once the child's stderr closes,
// which a caller awaits on the failure path so the reason is on disk before the
// throw; on success it runs unattended for the child's life.
let record = async (stderr: ReadableStream<Uint8Array>, pid: number) => {
  let file: Deno.FsFile | undefined
  try {
    Deno.mkdirSync(logsDir(), { recursive: true })
    file = Deno.openSync(`${logsDir()}/dev.log`, {
      create: true,
      append: true,
      write: true,
    })
    file.writeSync(
      new TextEncoder().encode(`\n--- successor pid=${pid} ---\n`),
    )
  } catch {
    // A log we cannot open is not a reason to lose the child's own output.
  }
  try {
    for await (let chunk of stderr) {
      try {
        file?.writeSync(chunk)
      } catch { /* durable write is best-effort */ }
      try {
        Deno.stderr.writeSync(chunk) // relayed when someone is watching
      } catch { /* the inherited stdio may be a dead socket */ }
    }
  } catch {
    // The stream aborted with the child; nothing left to record.
  } finally {
    try {
      file?.close()
    } catch { /* already gone */ }
  }
}
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
  // Sized to measured boot time with headroom for a loaded box. A child past
  // this is wedged rather than slow, so replacing it is the cure — but the
  // deadline only holds while boot stays bounded, so it moves when that does.
  let timer: ReturnType<typeof setTimeout> | undefined
  let late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('server did not become ready in 60s')),
      60_000,
    )
  })
  let child = new Deno.Command(path, {
    args: [...run, `--ready=${port}`],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'piped',
  }).spawn()
  // Drain and durably record the child's stderr for its whole life. Piped
  // stderr MUST be consumed or a chatty child blocks on a full pipe.
  let recorded = record(child.stderr, child.pid)
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
    // The child is condemned, so its stderr will close; wait for the pump so
    // the reason it died is on disk before this rejection propagates.
    await recorded
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

// One attempt at a time, made once the edits stop arriving and made AGAIN —
// on the same backoff a crash gets — until it reports success. An edit says
// the tree is newer than the process, and a failed handoff does not make that
// untrue, so the intent survives the failure. Dropping it is how a landed
// change ran nowhere: one handoff failed — a boot past its readiness deadline
// is enough — the supervisor kept the old child, and the tree stayed ahead of
// the process until some unrelated later edit happened to swap (T-14046). A
// crashed child was already healed this way; a failed handoff was not.
export let insist = (
  work: () => Promise<boolean>,
  waits = RETRY,
  quiet = 50,
) => {
  let pending = false
  let running = false
  let loop = async () => {
    running = true
    let n = 0
    while (pending) {
      pending = false
      await wait(quiet)
      if (pending) continue // still arriving — settle again
      // A rejection is a failure like any other. The supervisor absorbs it
      // (T-11139); an unhandled one would kill the process this loop serves.
      if (await work().catch((e) => (console.error(e), false))) n = 0
      else {
        pending = true
        await wait(waits[Math.min(++n, waits.length - 1)])
      }
    }
    running = false
  }
  return () => {
    pending = true
    if (!running) loop()
  }
}

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
    return true
  } catch (e) {
    console.error('server handoff failed —', e)
    // No successor, so the predecessor is still ours: lift the condemnation.
    stopping.delete(old)
    current = old
    // Unless the reprieve came too late — nothing watches a child whose
    // status already settled, so heal here or sit holding a dead handle.
    if (dead.has(old)) await revive(old)
    return false
  }
}

// The supervisor keeps the code it IMPORTED at its own start, and no process
// can re-import itself — so a landing that moves this file or reload.ts leaves
// the fleet supervised by the tree's predecessor, deciding handoffs and
// readiness by names and deadlines that main no longer has. It cannot fix
// itself in place; it can only ask to be born again. Stop the child first (the
// successor is a FIRST boot, not a join, and bind.ts refuses an occupied port
// to everyone else), then exit 42 — the repo's ask-to-be-relaunched code, the
// TUI's too. Whoever supervises this must run `deno task dev`, whose loop is
// what turns 42 into a relaunch: systemd would turn it into a `Restart=always`
// cgroup mass-kill instead (T-11139), and a bare `deno run src/dev.ts` gets a
// clean stop and this line, which beats serving yesterday's code in silence.
let relaunch = async () => {
  console.error('supervisor source changed — exiting 42 to be relaunched')
  await serial(async () => {
    if (current) await stop(current)
  })
  Deno.exit(42)
}

let supervise = async () => {
  // A lost boot race (bind.ts refused this process — another server holds the
  // port) is a clean stop, not a bug: one line and a non-42 exit ends the
  // `deno task dev` loop rather than dumping an uncaught stack. Only the FIRST
  // boot needs this; a later handoff/crash is absorbed by insist()/revive().
  try {
    current = watch(await launch())
  } catch (e) {
    console.error('supervisor could not start —', (e as Error).message)
    Deno.exit(1)
  }
  let handoff = insist(() => serial(swap))
  for await (let event of Deno.watchFs(src)) {
    if (event.paths.some(devFile)) return relaunch()
    if (event.paths.some(serverFile)) handoff()
  }
}

if (import.meta.main) await supervise()
