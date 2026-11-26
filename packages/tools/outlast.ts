/** Join an in-flight tool call and keep its answer for later pickup.
 * @module
 */
import type { Bundle } from '@yaks/graph'

/** How long a tool call can wait before returning progress. */
export let PATIENCE: number = 4_000

/** How long an answer nobody heard is kept for the next call to hear. */
export let KEPT: number = 15 * 60_000

/** How a call ended: its answer, or the refusal it said. */
export type Ended =
  & { timing?: string }
  & (
    | { said: Bundle[] }
    | { refused: { code: string; text: string } }
  )

/** What a caller hears: how the call ended, when it was asked, and whether it
 * was asked by an earlier call that heard it still running; or that it is,
 * and what it is doing when the run has said. */
export type Heard =
  | Ended & { asked: string; late?: true }
  | { running: string; doing?: string }

/** A run: given how to say what it is doing now, it ends. */
export type Run = (doing: (step: string) => void) => Promise<Ended>

/** The object's own storage, as much of it as this keeps. */
export type Keep = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
}

type Unread = { asked: string; ended: number; out: Ended }
type Job = {
  asked: string
  ended: Promise<Ended>
  heard: boolean
  late?: true
  doing?: string
}

let UNREAD = 'unread'

/** Run `callback` in `ms`, answering how to cancel it. */
export type After = (
  ms: number,
  callback: () => void | Promise<void>,
) => () => void

let timer: After = (ms, callback) => {
  let t = setTimeout(callback, ms)
  return () => clearTimeout(t)
}

/** Calls sharing an invocation key and lookup of a particular pending run. */
export type Calls = {
  (run: Run, wait?: number): Promise<Heard>
  read(asked: string, wait?: number): Promise<Heard>
}

/** One key's calls share a run, each waiting up to `patience`. The run
 * answers with its result or refusal. */
export let outlasting = (keep: Keep, {
  patience = PATIENCE,
  now = Date.now,
  after = timer,
  report = console.error,
}: {
  patience?: number
  now?: () => number
  after?: After
  report?: (error: unknown) => void
} = {}): Calls => {
  let job: Promise<Job> | null = null
  let taking = Promise.resolve()
  let take = (asked?: string) => {
    let next = taking.then(async () => {
      let unread = await keep.get<Unread>(UNREAD)
      if (!unread || (asked && asked != unread.asked)) return
      await keep.delete(UNREAD)
      if (now() - unread.ended < KEPT) return unread
    })
    taking = next.then(() => {}, () => {})
    return next
  }
  let begin = async (run: Run): Promise<Job> => {
    let unread = await take()
    if (unread) {
      return {
        asked: unread.asked,
        ended: Promise.resolve(unread.out),
        heard: false,
        late: true,
      }
    }
    let j: Job = {
      asked: new Date(now()).toISOString(),
      ended: Promise.resolve({ said: [] }),
      heard: false,
    }
    j.ended = run((step) => j.doing = step)
    return j
  }
  // Kept once every caller waiting has been answered: a timer runs after the
  // promise callbacks that answer the callers who were still waiting.
  let settle = async (mine: Promise<Job>, j: Job, out: Ended) => {
    if (!j.heard && !j.late) {
      await keep.put(UNREAD, { asked: j.asked, ended: now(), out })
      if (j.heard) await keep.delete(UNREAD)
    }
    if (job == mine) job = null
  }
  let hear = async (j: Job, wait: number): Promise<Heard> => {
    let cancel = () => {}
    let out = await Promise.race([
      j.ended,
      new Promise<null>((done) => cancel = after(wait, () => done(null))),
    ])
    cancel()
    if (!out) return { running: j.asked, ...j.doing ? { doing: j.doing } : {} }
    j.heard = true
    return { ...out, asked: j.asked, ...j.late ? { late: true as const } : {} }
  }
  let ask = async (run: Run, wait = patience) => {
    if (!job) {
      let mine: Promise<Job> = begin(run).then((j) => {
        j.ended.then(
          (out) => after(0, () => settle(mine, j, out).catch(report)),
          (error) => {
            if (job == mine) job = null
            report(error)
          },
        )
        return j
      }, (error) => {
        if (job == mine) job = null
        throw error
      })
      job = mine
    }
    return hear(await job, wait)
  }
  let read = async (asked: string, wait = patience): Promise<Heard> => {
    let active = await job
    if (active?.asked == asked) return hear(active, wait)
    let unread = active ? undefined : await take(asked)
    if (unread) return { ...unread.out, asked, late: true }
    return {
      asked,
      refused: {
        code: 'missing',
        text: 'This tool result is no longer pending.',
      },
    }
  }
  return Object.assign(ask, { read })
}
