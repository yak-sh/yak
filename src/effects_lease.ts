// The effects dispatcher's temporary process lease. This is leader election
// for an external side effect, not database locking: SQLite owns all database
// concurrency. The lease remains only until effects gain durable per-effect
// claims and guarded settlement in the graph.

let pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export let takeEffectsLease = async (
  db: string,
  {
    wait = false,
    deadlineMs = 330_000,
    poll = 50,
    rest = pause,
  }: {
    wait?: boolean
    deadlineMs?: number
    poll?: number
    rest?: (ms: number) => Promise<void>
  } = {},
): Promise<Deno.FsFile | undefined> => {
  if (db == ':memory:') return undefined
  let path = `${db}-effects.lock`
  let file = Deno.openSync(path, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  })
  if (file.tryLockSync(true)) return file
  if (!wait) {
    file.close()
    throw new Error(
      `effects lease for ${db} is already held — another dispatcher is active`,
    )
  }
  let deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    await rest(poll)
    if (file.tryLockSync(true)) return file
  }
  file.close()
  throw new Error(
    `effects lease for ${db} still held after ${deadlineMs}ms — the ` +
      `dispatcher did not release it`,
  )
}
