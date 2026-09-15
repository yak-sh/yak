// The development and deployed server supervisor: boots the server, then the
// effects daemon behind it, and revives whichever dies. It watches no files —
// a landed edit runs when tasksd is restarted by hand — so one serving process
// and one server connection set exist per owner database for as long as the
// supervisor lives.
import { peer } from './bind.ts'

let deno = Deno.execPath()
// The public address this supervisor answers for — read the same way server.ts
// reads it. Used only to tell a genuine lost race (another live supervisor
// already serves the port) from a transient first-boot crash (the address is
// empty), so the two get opposite handling in firstBoot() below.
let port = Number(Deno.env.get('PORT') ?? 5173)

// Where a child's death reason is kept. Mirrors sessions.ts logsDir() (its
// LOGS_DIR lever included), replicated rather than imported so the supervisor
// stays off the served module graph. A managed run's stdout file IS its log;
// the supervisor's children get the same treatment, one shared append log.
let logsDir = () =>
  Deno.env.get('LOGS_DIR') ?? `${Deno.env.get('HOME')}/.tasks/dev`

// Pump a child's stderr to a durable file AND relay it to ours. `inherit` sent
// every diagnostic to whatever stdio the supervisor had — on the live box a
// socket owned by a shell long gone — so four replacement deaths left no reason on
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
      new TextEncoder().encode(`\n--- server pid=${pid} ---\n`),
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

// A single-shot deadline; `beat` names what the child never reached, so a
// wedged bind reads differently from a wedged migrate. The message says the
// child is STILL RUNNING: a wedged boot is a different diagnosis from one that
// exited (the `died` arm), and a silent kill-and-retry is the outage T-14046
// was filed against.
let deadline = (pid: number, ms: number, beat: string) => {
  let timer: ReturnType<typeof setTimeout>
  let p = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `server pid ${pid} still not ${beat} ${
              Math.round(ms / 1000)
            }s after spawn — killing it`,
          ),
        ),
      ms,
    )
  })
  return { p, clear: () => clearTimeout(timer) }
}

// The READY beat must outlast a FULL boot over the live graph, and boot cost
// grows with the db: a bloated journal pushes migrate/index work into minutes
// (a 1.4GB graph booted ~5–7min, measured). Env-tunable so a large graph boots
// without the supervisor killing it at the door and respawning forever. The
// real cure is keeping the db small (VACUUM + journal retention, T-18290/T-21442);
// this only stops a slow boot from reading as a wedged one.
let bootMs = Number(Deno.env.get('TASKS_BOOT_DEADLINE_MS') ?? 900_000)

// Spawns the child with `--ready=<port>` appended and resolves once it has
// dialed that port back. The port rides argv so the address dies with the
// child; in the environment it would outlive this supervisor in every
// descendant shell.
//
export let launch = async (
  path = deno,
  run = args,
) => {
  using listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (listener.addr as Deno.NetAddr).port
  let began = Date.now()
  let child = new Deno.Command(path, {
    args: [...run, `--ready=${port}`],
    // Under this supervisor the topology is SPLIT (D-22388 step 3): the
    // server dispatches only its `where:'serve'` effects and the effectsd
    // child below owns the doing half. A bare `deno run src/server.ts`
    // (tests, probes) stays inline — the env is the supervisor's to set.
    env: { TASKS_EFFECTS: 'daemon' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'piped',
  }).spawn()
  console.error(
    `server pid ${child.pid} spawned — waiting for checkpointed ready`,
  )
  // Drain and durably record the child's stderr for its whole life. Piped
  // stderr MUST be consumed or a chatty child blocks on a full pipe.
  let recorded = record(child.stderr, child.pid)
  // An exit before readiness is a failure.
  let died = child.status.then((status) => {
    let error = new Error(
      `server pid ${child.pid} exited before ready (code ${status.code})`,
    ) as Error & { exitCode: number }
    error.exitCode = status.code
    throw error
  })
  // Await one ready beat under a deadline, or the child's death. Sized to
  // measured time with headroom for a loaded box; past it the child is wedged
  // rather than slow, so replacing it is the cure.
  let beat = async (ms: number, name: string) => {
    let d = deadline(child.pid, ms, name)
    try {
      await Promise.race([signal(listener), d.p, died])
    } finally {
      d.clear()
    }
  }
  try {
    await beat(bootMs, 'ready')
    // Boot duration on every success, so a creeping regression (2s → 10s → 60s)
    // is visible in the log LONG before it crosses the deadline and turns into
    // an unbounded respawn loop. Surfacing the slowdown early is what the
    // deadline alone cannot do (T-13914).
    console.error(`server pid ${child.pid} ready in ${Date.now() - began}ms`)
    return child
  } catch (e) {
    await retire(child, 'server boot')
    // The child is condemned, so its stderr will close; wait for the pump so
    // the reason it died is on disk before this rejection propagates.
    await recorded
    throw e
  }
}

// Condemned (we are retiring it) and departed (its status settled). A child
// can be both; the pair is what tells a death we caused from one we must heal.
let stopping = new WeakSet<Deno.ChildProcess>()
// The server this supervisor is answerable for.
let current: Deno.ChildProcess | undefined

let gone = (e: unknown) =>
  e instanceof Deno.errors.NotFound ||
  (e instanceof TypeError &&
    e.message == 'Child process has already terminated')

// A settle is a grace period, not permission to retain a writer beside its
// replacement. Even after SIGKILL, wait for status: sending a signal is not
// proof that the process (and every SQLite descriptor it held) has exited.
export let retire = async (
  child: Pick<Deno.ChildProcess, 'pid' | 'kill' | 'status'>,
  name: string,
  ms = 30_000,
) => {
  console.error(`${name} pid ${child.pid} SIGTERM — exit deadline ${ms}ms`)
  try {
    child.kill('SIGTERM')
  } catch (e) {
    if (!gone(e)) throw e
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    let exited = await Promise.race([
      child.status.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ms)
      }),
    ])
    if (!exited) {
      console.error(
        `${name} pid ${child.pid} exit deadline exceeded — SIGKILL (runner loss)`,
      )
      try {
        child.kill('SIGKILL')
      } catch (e) {
        if (!gone(e)) throw e
      }
    }
    let status = await child.status
    console.error(
      `${name} pid ${child.pid} exited code=${status.code} signal=${
        status.signal ?? 'none'
      }`,
    )
  } finally {
    clearTimeout(timer)
  }
}

// The sequencing seam for crash recovery.
// Stop the doing owner BEFORE closing the old server's connection set; start
// its successor only AFTER launch has received the checkpointed READY beat.
// Callers serialize this whole pair, including invalidating respawn backoffs.
export let handoff = (o: {
  stopEffects: () => Promise<void>
  stopServer: () => Promise<void>
  launch: () => Promise<void>
  startEffects: () => void
}) => {
  let stop = async () => {
    await o.stopEffects()
    await o.stopServer()
  }
  let start = async () => {
    await o.launch()
    o.startEffects()
  }
  return {
    stop,
    start,
    replace: async () => {
      await stop()
      await start()
    },
  }
}

// Every mint and retire runs here, one at a time: two crash-relaunches
// interleaved can lose a handle to a process nobody can stop.
let lock: Promise<unknown> = Promise.resolve()
let serial = <T>(work: () => Promise<T>): Promise<T> => {
  let done = lock.then(work, work)
  lock = done.catch(() => {})
  return done
}

// Backoff for a replacement that will not boot: climbs while boots keep
// failing, resets on one that stands up. A bad commit should idle the box,
// not spin it.
const RETRY = [0, 1_000, 2_000, 5_000, 10_000, 30_000]

// A supervisor ABSORBS its child's death; it never escalates one. Exiting
// here hands the problem to systemd, and `Restart=always` mass-kills this
// unit's cgroup — where the operator tmux tree lives — so a crash we could
// heal in a second costs every operator mid-turn instead (T-11139). There is
// no failure a child can have that the supervisor improves by dying too.
let revive = async (departed: Deno.ChildProcess) => {
  if (current != departed) return // already replaced
  await lifecycle.stop()
  for (let n = 0;; n++) {
    let ms = RETRY[Math.min(n, RETRY.length - 1)]
    if (ms) await wait(ms)
    try {
      await lifecycle.start()
      return
    } catch (e) {
      console.error('server relaunch failed —', e)
    }
  }
}

let watch = (child: Deno.ChildProcess) => {
  child.status.then((status) => {
    if (stopping.has(child)) return
    console.error(
      `server pid ${child.pid} stopped unexpectedly (${status.code}) — relaunching`,
    )
    serial(() => revive(child))
  })
  return child
}

let stop = async (child: Deno.ChildProcess) => {
  stopping.add(child)
  await retire(child, 'server')
}

// The FIRST boot, made as resilient as every later one. A child can exit
// before ready for two very different reasons that look identical from here
// ("exited before ready (code N)"):
//
//   - A genuine LOST RACE: another live supervisor already serves this port
//     (bind.ts refuses the second). holdco-up relaunches `deno task dev`
//     periodically, so this happens every time the graph is already up.
//     Retrying can never win the port and would leave a zombie idle supervisor
//     each tick, so step aside cleanly (a healthy peer answers /graph even
//     mid-migration, so this is detectable at once).
//
//   - A TRANSIENT crash: the child died before ready and the address is now
//     EMPTY (e.g. the vector extension's init losing a race during a boot
//     storm). This is exactly the failure revive() heals AFTER first boot; the
//     old single-shot exit(1) instead took the whole graph down until cron
//     respawned it — the flap-to-dead. Heal it here on the same backoff.
//
// A supervisor never exits on a healable failure (line: revive's rationale),
// and a persistently broken build idles the box at the 30s backoff cap rather
// than spinning — the same contract revive() already honors.
let firstBoot = async (): Promise<Deno.ChildProcess> => {
  for (let n = 0;; n++) {
    let ms = RETRY[Math.min(n, RETRY.length - 1)]
    if (ms) await wait(ms)
    try {
      return watch(await launch())
    } catch (e) {
      console.error('server first boot failed —', (e as Error).message)
      if ((e as Error & { exitCode?: number }).exitCode == 73) {
        console.error(
          'another server owns this graph — supervisor is stepping aside',
        )
        Deno.exit(73)
      }
      if (await peer(port)) {
        console.error(
          `port ${port} already served by another supervisor — stepping aside`,
        )
        Deno.exit(0)
      }
      // Address empty: transient crash. Loop and retry on backoff.
    }
  }
}

// The effects daemon (effectsd.ts, D-22388 step 3) — the doing half of the
// split the server env above declares. Spawned only after a server is READY,
// respawned on death with the same backoff a server crash gets, and replaced
// after every successful replacement so it always runs the tree's code. No ready
// beat: it binds nothing; its boot relay + feed pick up whatever queued.
let effectsArgs = ['run', '-A', 'src/effectsd.ts']
let effectsd: Deno.ChildProcess | undefined
let effectsGen = 0
let spawnEffects = () => {
  let gen = ++effectsGen
  let boot = (n: number) => {
    if (gen != effectsGen) return // replaced while backing off
    try {
      let child = new Deno.Command(deno, {
        args: effectsArgs,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'piped',
      }).spawn()
      console.error(
        `effectsd pid ${child.pid} spawned after server pid ${current?.pid} checkpointed ready`,
      )
      record(child.stderr, child.pid)
      effectsd = child
      child.status.then((status) => {
        if (gen != effectsGen) return // condemned by a replace or shutdown
        console.error(
          `effectsd pid ${child.pid} stopped unexpectedly (${status.code}) — relaunching`,
        )
        setTimeout(
          () => boot(n + 1),
          RETRY[Math.min(n + 1, RETRY.length - 1)],
        )
      })
    } catch (e) {
      console.error('effectsd spawn failed —', e)
      setTimeout(() => boot(n + 1), RETRY[Math.min(n + 1, RETRY.length - 1)])
    }
  }
  boot(0)
}
let stopEffects = async () => {
  effectsGen++ // condemn: the status handler above stands down
  let child = effectsd
  if (child) await retire(child, 'effectsd')
  effectsd = undefined
}
let lifecycle = handoff({
  stopEffects,
  stopServer: async () => {
    if (current) await stop(current)
  },
  launch: async () => {
    current = watch(await launch())
  },
  startEffects: spawnEffects,
})
let supervise = async () => {
  current = await firstBoot()
  spawnEffects()
  await new Promise<never>(() => {}) // the children's deaths keep us busy
}

if (import.meta.main) await supervise()
