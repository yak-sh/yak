/** Cooperative, preannounced SQLite migrations. Not a distributed lock service. */
import type { Driver } from './driver.ts'

const table = '_yaks_migration'
export type MigrationState = {
  generation: number
  migration: string
  state: 'pending' | 'applied' | 'failed'
  announced: number
  notBefore: number
  finished: number | null
  error: string | null
}
export type MigrationControl = {
  read: () => MigrationState | undefined
  ready: () => number
  announce: (migration: string, graceMs?: number) => MigrationState
  apply: (claim: MigrationState, change: (db: Driver) => void) => void
  fail: (claim: MigrationState, reason: string) => void
  acknowledge: (generation: number) => void
  run: (
    name: string,
    change: (db: Driver) => void,
    options?: { intervalMs?: number; marginMs?: number },
  ) => Promise<MigrationState>
}
export type MigrationWatch = { check: () => void; stop: () => void }
export class MigrationPending extends Error {
  constructor(public readonly migration: MigrationState) {
    super(
      `Database migration ${migration.migration} is ${migration.state}; restart required`,
    )
    this.name = 'MigrationPending'
  }
}

/** Open at top level, before application schema installation. All peers must
 * deploy this control table before relying on announcement protection. */
export function migrations(db: Driver): MigrationControl {
  db.exec(`create table if not exists ${table} (
    singleton integer primary key check(singleton = 1),
    generation integer not null, migration text not null,
    state text not null, announced real not null, not_before real not null,
    finished real, error text)`)
  const read = (): MigrationState | undefined => {
    const r = db.query(`select * from ${table} where singleton = 1`, [])[0]
    return r && {
      generation: Number(r.generation),
      migration: String(r.migration),
      state: r.state as MigrationState['state'],
      announced: Number(r.announced),
      notBefore: Number(r.not_before),
      finished: r.finished == null ? null : Number(r.finished),
      error: r.error == null ? null : String(r.error),
    }
  }
  // BEGIN IMMEDIATE serializes claims across connections. These APIs must not
  // run inside a caller's transaction: the announcement must become visible.
  const transaction = <T>(body: () => T): T => {
    db.exec('begin immediate')
    try {
      const value = body()
      db.exec('commit')
      return value
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }
  const ready = () => {
    const value = read()
    if (value && value.state != 'applied') throw new MigrationPending(value)
    return value?.generation ?? 0
  }
  const announce = (migration: string, graceMs = 1100): MigrationState => {
    if (!migration.trim() || !Number.isFinite(graceMs) || graceMs < 0) {
      throw new TypeError('Migration name and nonnegative graceMs required')
    }
    return transaction(() => {
      const generation = ready() + 1
      const now = Date.now()
      db.query(
        `insert into ${table} values (1, ?, ?, 'pending', ?, ?, null, null)
        on conflict(singleton) do update set generation=excluded.generation,
        migration=excluded.migration, state=excluded.state,
        announced=excluded.announced, not_before=excluded.not_before,
        finished=null, error=null`,
        [generation, migration, now, now + graceMs],
      )
      return read()!
    })
  }
  const owned = (claim: MigrationState) => {
    const current = read()
    if (
      !current || current.generation != claim.generation ||
      current.migration != claim.migration || current.state != 'pending'
    ) {
      throw new Error('Migration announcement is no longer pending or owned')
    }
    return current
  }
  const fail = (claim: MigrationState, reason: string) =>
    transaction(() => {
      owned(claim)
      db.query(
        `update ${table} set state='failed', finished=?, error=? where singleton=1`,
        [Date.now(), reason],
      )
    })
  const apply = (claim: MigrationState, change: (db: Driver) => void) => {
    try {
      transaction(() => {
        const current = owned(claim)
        if (Date.now() < current.notBefore) {
          throw new Error('Migration grace period has not elapsed')
        }
        const result: unknown = change(db)
        if (result && typeof (result as Promise<unknown>).then == 'function') {
          throw new TypeError('Migration callback must be synchronous')
        }
        db.query(
          `update ${table} set state='applied', finished=?, error=null where singleton=1`,
          [Date.now()],
        )
      })
    } catch (error) {
      // Do not mutate a superseded claim or mark an early apply as a failure.
      const current = read()
      if (
        current?.generation == claim.generation && current.state == 'pending' &&
        Date.now() >= current.notBefore
      ) fail(claim, String(error))
      throw error
    }
  }
  return {
    read,
    ready,
    announce,
    apply,
    fail,
    /** Explicit operator recovery after inspecting/repairing failed or abandoned
     * work. This does NOT undo a migration or decide whether retry is safe. */
    acknowledge: (generation: number) =>
      transaction(() => {
        const current = read()
        if (!current || current.generation != generation) {
          throw new Error('Migration generation changed')
        }
        db.query(
          `update ${table} set state='applied', finished=? where singleton=1`,
          [Date.now()],
        )
      }),
    /** Publish first, then wait with no write transaction held. Peers must poll
     * no slower than intervalMs; margin is scheduling slack, not an ACK. */
    run: async (
      name: string,
      change: (db: Driver) => void,
      options: { intervalMs?: number; marginMs?: number } = {},
    ) => {
      const interval = options.intervalMs ?? 1000
      const margin = options.marginMs ?? 100
      if (
        !Number.isFinite(interval) || interval <= 0 ||
        !Number.isFinite(margin) || margin < 0
      ) {
        throw new TypeError('Invalid polling interval/margin')
      }
      const claim = announce(name, interval + margin)
      while (Date.now() < claim.notBefore) {
        await new Promise((resolve) =>
          setTimeout(resolve, claim.notBefore - Date.now())
        )
      }
      apply(claim, change)
      return read()!
    },
  }
}

/** One polling loop per host connection, no per-operation queries. A generation
 * change latches even if pending was missed. Callback runs once; caller owns
 * admission/drain/close policy. Poll errors also stop the monitor. */
export function watchMigrations(
  control: MigrationControl,
  changed: (reason: Error) => void,
  intervalMs = 1000,
): MigrationWatch {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError('Invalid polling interval')
  }
  const baseline = control.ready()
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    stopped = true
    clearInterval(timer)
  }
  const check = () => {
    if (stopped) return
    let error: Error | undefined
    try {
      const current = control.read()
      if (
        current &&
        (current.generation != baseline || current.state != 'applied')
      ) {
        error = new MigrationPending(current)
      }
    } catch (cause) {
      error = new Error('Migration monitor failed; restart required', { cause })
    }
    if (error) {
      stop()
      changed(error)
    }
  }
  timer = setInterval(check, intervalMs)
  return { check, stop }
}
