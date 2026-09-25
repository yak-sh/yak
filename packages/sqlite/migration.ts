/** Cooperative, preannounced SQLite migrations. Not a distributed lock service. */
import {
  col,
  type Driver,
  eq,
  type Expr,
  lit,
  select,
  table,
  val,
} from '@yaks/sql'

const CONTROL = '_yaks_migration'
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
  db.query({
    t: 'create table',
    name: CONTROL,
    ifNot: true,
    cols: [
      {
        name: 'singleton',
        type: 'integer',
        pk: true,
        check: eq(col('singleton'), lit(1)),
      },
      { name: 'generation', type: 'integer', notNull: true },
      { name: 'migration', type: 'text', notNull: true },
      { name: 'state', type: 'text', notNull: true },
      { name: 'announced', type: 'real', notNull: true },
      { name: 'not_before', type: 'real', notNull: true },
      { name: 'finished', type: 'real' },
      { name: 'error', type: 'text' },
    ],
  })
  const one = eq(col('singleton'), lit(1))
  const set = (set: Record<string, Expr>) =>
    db.query({ t: 'update', table: CONTROL, set, where: one })
  const read = (): MigrationState | undefined => {
    const r = db.query(select({ from: table(CONTROL), where: one }))[0]
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
    db.query({ t: 'begin', mode: 'immediate' })
    try {
      const value = body()
      db.query({ t: 'commit' })
      return value
    } catch (error) {
      db.query({ t: 'rollback' })
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
      const row: Record<string, Expr> = {
        singleton: lit(1),
        generation: val(generation),
        migration: val(migration),
        state: val('pending'),
        announced: val(now),
        not_before: val(now + graceMs),
        finished: lit(null),
        error: lit(null),
      }
      db.query({
        t: 'insert',
        into: CONTROL,
        cols: Object.keys(row),
        rows: [Object.values(row)],
        upsert: [{
          on: [col('singleton')],
          set: Object.fromEntries(
            Object.keys(row).filter((k) => k != 'singleton')
              .map((k) => [k, col(k, 'excluded')]),
          ),
        }],
      })
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
      set({
        state: val('failed'),
        finished: val(Date.now()),
        error: val(reason),
      })
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
        set({
          state: val('applied'),
          finished: val(Date.now()),
          error: lit(null),
        })
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
     * work. This does not undo a migration or decide whether retry is safe. */
    acknowledge: (generation: number) =>
      transaction(() => {
        const current = read()
        if (!current || current.generation != generation) {
          throw new Error('Migration generation changed')
        }
        set({ state: val('applied'), finished: val(Date.now()) })
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

/** One polling loop per application connection, no per-operation queries. A
 * generation change latches even if pending was missed. Callback runs once;
 * caller owns admission/drain/close policy. Poll errors also stop the
 * monitor. */
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
