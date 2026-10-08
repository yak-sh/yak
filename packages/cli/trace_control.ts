// Capture controls live beside the watched database, not inside it. Idle work
// consults memory only; an unreferenced timer refreshes it between operations.
import type { Command } from './run.ts'
import type { Config } from './config.ts'

export type TraceSelection = { requested: boolean; rate: number }
export type TraceSetting = { next?: number; rate?: number; process?: number }
export type TraceState = { next: number; rate: number; process?: number }
type Bucket = { next: number; rate?: number }
type State = { next: number; rate: number; processes: Record<string, Bucket> }
// OS advisory locks are process-wide on some platforms. Serialize handles
// inside this process as well as locking against other processes.
let pending = new Map<string, Promise<unknown>>()
let serial = <T>(path: string, run: () => Promise<T>): Promise<T> => {
  let before = pending.get(path) ?? Promise.resolve()
  let next = before.catch(() => {}).then(run)
  pending.set(path, next)
  void next.finally(() => {
    if (pending.get(path) == next) pending.delete(path)
  }).catch(() => {})
  return next
}
let empty = (): State => ({ next: 0, rate: 0, processes: {} })
let valid = (said: TraceSetting): void => {
  if (
    said.next != null && (!Number.isSafeInteger(said.next) || said.next < 0)
  ) {
    throw new Error('--next must be a nonnegative safe integer')
  }
  if (
    said.rate != null &&
    (!Number.isFinite(said.rate) || said.rate < 0 || said.rate > 1)
  ) {
    throw new Error('--rate must be between zero and one')
  }
  if (
    said.process != null &&
    (!Number.isSafeInteger(said.process) || said.process <= 0)
  ) {
    throw new Error('--process must be a positive process ID')
  }
}
let decoded = (text: string): State => {
  let said = JSON.parse(text) as State
  valid(said)
  if (
    said.next == null || said.rate == null || !said.processes ||
    typeof said.processes != 'object'
  ) {
    throw new Error('invalid trace control')
  }
  for (let [pid, bucket] of Object.entries(said.processes)) {
    valid({ ...bucket, process: Number(pid) })
    if (bucket.next == null) throw new Error('invalid trace control')
  }
  return said
}

/** Shared capture budget for this database. A PID-specific budget takes
 * precedence over the global one; a PID rate overrides the global rate.
 * Opening never writes. Only arming or consuming an armed capture writes, and
 * an advisory lock serializes those changes across independent box processes.
 * Another process's arming is noticed within `every` ms. */
export let traceControl = (db: string, pid = Deno.pid, every = 250) => {
  let memory = db == ':memory:'
  let path = new URL(`${db}.trace.json`, `file://${Deno.cwd()}/`).pathname
  let directory = path.slice(0, path.lastIndexOf('/')) || '.'
  let state = empty()
  let closed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let signature: string | undefined
  let changing = false
  let read = (): State => {
    if (memory) return state
    try {
      return decoded(Deno.readTextFileSync(path))
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return empty()
      throw error
    }
  }
  let refresh = () => {
    try {
      state = read()
    } catch {
      // Broken controls cannot break the work being watched or arm by accident.
      state = empty()
    }
  }
  // Poll independently of requests. A stat is cheap, and only a changed
  // sidecar is decoded. Unlike node:fs.watch this owns no fs-event resource
  // that can interfere with the host's HTTP drain in Deno.
  let fingerprint = () => {
    try {
      let file = Deno.statSync(path)
      return JSON.stringify([file.mtime?.getTime(), file.size, file.ino])
    } catch {
      return undefined
    }
  }
  signature = fingerprint()
  refresh()
  if (!memory) {
    timer = setInterval(() => {
      if (changing) return
      let next = fingerprint()
      if (next !== signature) {
        signature = next
        refresh()
      }
    }, every)
    Deno.unrefTimer(timer)
  }
  let rate = () => state.processes[String(pid)]?.rate ?? state.rate
  let armed = () =>
    (state.processes[String(pid)]?.next ?? 0) > 0 || state.next > 0
  let locked = async <T>(change: () => T): Promise<T> => {
    if (closed) throw new Error('trace control is closed')
    if (memory) return change()
    return await serial(path, async () => {
      await Deno.mkdir(directory, { recursive: true })
      let file = await Deno.open(`${path}.lock`, { create: true, write: true })
      try {
        await file.lock(true)
        changing = true
        state = read()
        let before = JSON.stringify(state)
        let result = change()
        let after = JSON.stringify(state)
        if (before == after) return result
        let temporary = `${path}.${crypto.randomUUID()}.tmp`
        try {
          await Deno.writeTextFile(temporary, after + '\n', {
            mode: 0o600,
          })
          await Deno.rename(temporary, path)
        } finally {
          await Deno.remove(temporary).catch(() => {})
        }
        signature = fingerprint()
        return result
      } finally {
        changing = false
        await file.unlock()
        file.close()
      }
    })
  }
  return {
    take: (): Promise<TraceSelection> => {
      if (closed || !armed()) {
        return Promise.resolve({ requested: false, rate: rate() })
      }
      return locked(() => {
        let targeted = state.processes[String(pid)]
        let bucket = targeted && targeted.next > 0 ? targeted : state
        let requested = bucket.next > 0
        if (requested) bucket.next--
        return { requested, rate: rate() }
      })
    },
    set: (said: TraceSetting): Promise<TraceState> => {
      valid(said)
      return locked(() => {
        let bucket = said.process == null
          ? state
          : state.processes[String(said.process)] ??= { next: 0 }
        if (said.next != null) bucket.next = said.next
        if (said.rate != null) bucket.rate = said.rate
        return {
          next: bucket.next,
          rate: bucket.rate ?? state.rate,
          ...said.process != null ? { process: said.process } : {},
        }
      })
    },
    close: () => {
      closed = true
      if (timer != null) clearInterval(timer)
    },
  }
}

/** This command never opens the watched graph. Target the web server with
 * `yak trace --config FILE --process SERVER_PID --next N`. */
export let traceCommand = (config: Config): Command => ({
  name: 'trace',
  title: 'Arm box traces',
  description:
    'Capture the next N box operations or set their sampling rate. --process targets one server or worker PID; without it, all processes sharing this config consume one budget. Controls are written beside the database, without opening it.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      next: {
        type: 'integer',
        minimum: 0,
        description: 'the next N operations to capture',
      },
      rate: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'ordinary sampling probability, default zero',
      },
      process: {
        type: 'integer',
        minimum: 1,
        description: 'capture only this server or worker PID',
      },
    },
  },
  run: async (args, context) => {
    if (!config.db || config.db == ':memory:') {
      throw new Error('trace needs a config naming a database file')
    }
    if (args.next == null && args.rate == null) {
      throw new Error('trace needs --next or --rate')
    }
    let control = traceControl(config.db)
    try {
      let result = await control.set(args as TraceSetting)
      context.out(JSON.stringify(result))
      return 0
    } finally {
      control.close()
    }
  },
})
