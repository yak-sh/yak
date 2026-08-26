// The DB WRITER baton — an advisory exclusive lock beside the graph file that
// serializes which process may WRITE (or checkpoint) it. Reads never take it:
// WAL already lets many readers run beside the one writer, and that pairing is
// safe. What is NOT safe is two WRITERS over one file — a deploy's successor
// migrating and casting beside its still-live predecessor. That overlap
// corrupted the live WAL twice (SIGBUS mid-write, "database disk image is
// malformed"): T-20223. The baton closes the window: a successor must hold it
// before it migrates or writes, and the predecessor holds it until it EXITS —
// which the kernel turns into a release on ANY end (clean drain, crash,
// SIGKILL, SIGBUS), so no reap and no handshake can leave it stuck held.
//
// Per graph FILE, on a dedicated `<db>-writer.lock` sidecar (never the DB file
// itself, which would fight SQLite's own POSIX locks). ':memory:' and every
// test/probe copy carry their own path, so the live baton only ever serializes
// real successors of the live graph — a probe on a copied file never contends.

let pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// One synchronous grab, no waiting: the held FsFile, or undefined if a live
// process has the baton. For callers inside synchronous boot code (connect()'s
// WAL salvage) that need "am I the sole owner RIGHT NOW" — a transient hold
// they close as soon as the guarded work is done, which never reorders the
// takeBaton semantics above.
export let tryBaton = (
  db: string,
  suffix = '-writer.lock',
): Deno.FsFile | undefined => {
  if (db == ':memory:') return undefined
  let file = Deno.openSync(`${db}${suffix}`, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  })
  if (file.tryLockSync(true)) return file
  file.close()
  return undefined
}

// The held baton is the FsFile whose lock the kernel drops when this process
// ends; the caller keeps it for the process lifetime and never closes it —
// closing would surrender the writer role while still serving. ':memory:'
// returns undefined: nothing to hold, nothing to contend.
//
// `wait` splits the two callers. A sole writer (first boot, revive, test,
// probe) passes wait:false and expects the baton free NOW — a held one there
// means a second server already writes this graph, which is a bug to surface,
// not to sit on. A deploy successor (--join) passes wait:true: its predecessor
// holds the baton and will release it on exit, so it polls (yielding the event
// loop, so the successor keeps serving reads meanwhile) until the baton frees
// or the deadline names a predecessor that would not let go.
export let takeBaton = async (
  db: string,
  {
    wait = false,
    deadlineMs = 330_000,
    poll = 50,
    rest = pause,
    suffix = '-writer.lock',
  }: {
    wait?: boolean
    deadlineMs?: number
    poll?: number
    rest?: (ms: number) => Promise<void>
    // Which sidecar this baton serializes: '-writer.lock' is the schema/WAL
    // writer; '-effects.lock' is the effects daemon's exactly-one-dispatcher
    // lease (D-22388 step 3). Same kernel-released flock either way.
    suffix?: string
  } = {},
): Promise<Deno.FsFile | undefined> => {
  if (db == ':memory:') return undefined
  let file = Deno.openSync(`${db}${suffix}`, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  })
  if (file.tryLockSync(true)) return file
  if (!wait) {
    file.close()
    throw new Error(
      `db baton ${suffix} for ${db} is already held — another process owns ` +
        `this role. Stop it, or point DB_PATH at a free copy.`,
    )
  }
  let deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    await rest(poll)
    if (file.tryLockSync(true)) return file
  }
  file.close()
  throw new Error(
    `db baton ${suffix} for ${db} still held after ${deadlineMs}ms — the ` +
      `predecessor did not release it`,
  )
}
