// Cross-runtime writer-baton contention (T-22890, D-22804 §8). The Deno→Rust
// swap hands the writer role from a Deno PREDECESSOR to a Rust SUCCESSOR, and
// the two MUST serialize on ONE OS lock or the two-writer WAL corruption returns
// (T-20223). Deno's `FsFile.tryLockSync(true)` is `flock(fd, LOCK_EX|LOCK_NB)`
// on Linux (strace-verified: the byte-range fcntl locks in a Deno process are
// SQLite's own POSIX locks, not this baton), so the Rust port (baton.rs) takes
// `flock(2)` on the SAME `<db>-writer.lock` sidecar. flock and fcntl locks are
// independent classes on Linux, so a mismatched primitive would NOT contend —
// these probes PROVE the two runtimes fight over one flock, in both directions.
//
// The Rust half is exercised through the `baton_probe` example (crates/yak-kernel):
//   try  <db> [suffix]  — try_baton once; prints acquired/held, exits 0/3
//   hold <db> [suffix]  — take_baton, prints `held`, then blocks holding it
// Slow tier: it builds and spawns a real Rust binary. It SKIPS (not fails) when
// there is no cargo toolchain, mirroring bin/rust-gate — a Rust-less box must
// not turn the tier red.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { takeBaton } from './baton.ts'
import { slow, until } from './testing.ts'

let root = new URL('../', import.meta.url).pathname // src/ → repo root
let probeBin = `${root}target/debug/examples/baton_probe`

// cargo, from PATH or the rustup default dir; null if the box has no toolchain
// (bin/rust-gate's own graceful-skip rule).
let findCargo = async (): Promise<string | null> => {
  let home = Deno.env.get('HOME') ?? ''
  for (let cargo of ['cargo', home ? `${home}/.cargo/bin/cargo` : '']) {
    if (!cargo) continue
    try {
      let { success } = await new Deno.Command(cargo, {
        args: ['--version'],
        stdout: 'null',
        stderr: 'null',
      }).output()
      if (success) return cargo
    } catch {
      // not here — try the next candidate
    }
  }
  return null
}

// Build the probe once; return its path, or null to skip when cargo is absent.
let buildProbe = async (): Promise<string | null> => {
  let cargo = await findCargo()
  if (!cargo) return null
  let { success, stderr } = await new Deno.Command(cargo, {
    args: ['build', '-p', 'yak-kernel', '--example', 'baton_probe'],
    cwd: root,
    stdout: 'null',
    stderr: 'piped',
  }).output()
  if (!success) {
    throw new Error(
      `cargo build baton_probe failed: ${new TextDecoder().decode(stderr)}`,
    )
  }
  return probeBin
}

let tmp = () => `${Deno.makeTempDirSync()}/graph.db`

// One-shot `baton_probe try` → its exit code (0 acquired, 3 held).
let rustTry = async (
  bin: string,
  db: string,
  suffix?: string,
): Promise<number> => {
  let { code } = await new Deno.Command(bin, {
    args: suffix ? ['try', db, suffix] : ['try', db],
    stdout: 'null',
    stderr: 'null',
  }).output()
  return code
}

// Spawn `baton_probe hold`, wait until it reports `held` (so the flock is
// actually taken before the caller races it), and return the child to kill.
let rustHold = async (
  bin: string,
  db: string,
  suffix?: string,
): Promise<Deno.ChildProcess> => {
  let child = new Deno.Command(bin, {
    args: suffix ? ['hold', db, suffix] : ['hold', db],
    stdout: 'piped',
    stderr: 'null',
  }).spawn()
  let reader = child.stdout.getReader()
  let seen = ''
  await until(async () => {
    let { value, done } = await reader.read()
    if (value) seen += new TextDecoder().decode(value)
    return seen.includes('held') || done
  }, { label: () => `rust hold to report held (saw: ${JSON.stringify(seen)})` })
  reader.releaseLock()
  return child
}

let kill = async (child: Deno.ChildProcess) => {
  try {
    child.kill('SIGKILL')
  } catch {
    // already gone
  }
  await child.status
}

slow(
  'Deno holds the writer baton → a Rust taker is refused, then acquires',
  async () => {
    let bin = await buildProbe()
    if (!bin) return console.warn('baton_crossruntime: no cargo — skipping')
    let db = tmp()
    let held = await takeBaton(db) // Deno holds -writer.lock (flock LOCK_EX)
    // A Rust try on the SAME sidecar is refused — proves the flocks contend.
    assertEquals(await rustTry(bin, db), 3)
    held!.close() // the kernel-released drop a real exit would do
    // Freed → Rust acquires.
    assertEquals(await rustTry(bin, db), 0)
  },
)

slow(
  'Rust holds the writer baton → Deno takeBaton throws, then acquires',
  async () => {
    let bin = await buildProbe()
    if (!bin) return console.warn('baton_crossruntime: no cargo — skipping')
    let db = tmp()
    let rust = await rustHold(bin, db) // Rust holds -writer.lock
    try {
      let e = await assertRejects(() => takeBaton(db)) // wait:false
      assertStringIncludes((e as Error).message, 'already held')
    } finally {
      await kill(rust) // SIGKILL → the kernel frees the flock (no unlock path)
    }
    // Freed → Deno acquires.
    let after = await takeBaton(db)
    after!.close()
  },
)

slow(
  'the writer and effects locks are independent across runtimes',
  async () => {
    let bin = await buildProbe()
    if (!bin) return console.warn('baton_crossruntime: no cargo — skipping')
    let db = tmp()
    // Rust holds -effects.lock; Deno takes -writer.lock on the same db — separate
    // sidecars, so they coexist (the D-22388 split the effects daemon needs).
    let rustEffects = await rustHold(bin, db, '-effects.lock')
    try {
      let writer = await takeBaton(db) // default -writer.lock
      assertEquals(typeof writer, 'object')
      writer!.close()
      // …but a Rust taker of the SAME effects role IS refused while Rust holds it.
      assertEquals(await rustTry(bin, db, '-effects.lock'), 3)
    } finally {
      await kill(rustEffects)
    }
  },
)
