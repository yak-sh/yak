// A call that outlasts its caller (T-141686). An agent's client waits about a
// minute for a tool call (the claude.ai connector said "The operation timed
// out." at 60 s), and a release can take longer: one that compiles in a cold
// container, or again under a compiler rollout, released jeff/yak-sh v42 92 s
// after it was asked, to a caller that had heard a timeout. A Worker cannot
// finish work after it answers (`waitUntil` lends 30 s), so a tool that may
// take longer than its caller waits (tools.ts `outlasts`) runs in a Durable
// Object, one per caller, tool and target (index.ts `Outlast`), where pending
// I/O keeps the object up until the work ends (wrangler.toml
// `durable_object_io_tasks_prevent_eviction`).
//
// The door waits {@link PATIENCE} for it, and within that the answer is the
// tool's own. Past it, the answer says the call is still running, and what it
// is doing, where the tool has said (tool.ts `Ctx.doing`). The next
// call with the same key joins a run still going, or is handed the answer of
// one nobody heard, once, in place of running again.
import type { Bundle } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import type { Caller } from './session.ts'

/** How long the door waits before answering that a call is still running:
 * well inside the minute a client gives a call. */
export let PATIENCE = 40_000

/** How long an answer nobody heard is kept for the next call to hear. */
export let KEPT = 15 * 60_000

/** How a call ended: its answer, or the refusal it said. */
export type Ended =
  | { said: Bundle[] }
  | { refused: { code: string; text: string } }

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

/** One key's calls: one run at a time, joined by every call that arrives while
 * it runs, each waiting at most `patience`. `run` never rejects; a refusal or
 * a failure is how it ended. */
export let outlasting = (keep: Keep, {
  patience = PATIENCE,
  now = Date.now,
  after = timer,
}: { patience?: number; now?: () => number; after?: After } = {}) => {
  let job: Promise<Job> | null = null
  let begin = async (run: Run): Promise<Job> => {
    let unread = await keep.get<Unread>(UNREAD)
    if (unread) {
      await keep.delete(UNREAD)
      if (now() - unread.ended < KEPT) {
        return {
          asked: unread.asked,
          ended: Promise.resolve(unread.out),
          heard: false,
          late: true,
        }
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
    if (job == mine) job = null
    if (!j.heard && !j.late) {
      await keep.put(UNREAD, { asked: j.asked, ended: now(), out })
    }
  }
  return async (run: Run, wait = patience): Promise<Heard> => {
    if (!job) {
      let mine: Promise<Job> = begin(run).then((j) => {
        j.ended.then((out) => after(0, () => settle(mine, j, out)))
        return j
      })
      job = mine
    }
    let j = await job
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
}

/** A call, as the door hands it to the object: the tool, what it was asked,
 * and who asked through which credential. */
export type Asked = {
  tool: string
  args: Record<string, unknown>
  call?: string
  person: string
  who?: Caller
  patience?: number
}

/** The objects calls outlast their callers in (index.ts `Outlast`). */
export type Outlasts = {
  idFromName(name: string): unknown
  get(id: unknown): { call(asked: Asked): Promise<Heard> }
}

let said = (body: string, value?: Record<string, unknown>, call?: string) => [{
  entity: { eid: '$said' },
  content: { body },
  output: { ...call ? { source: call } : {}, ...value ? { value } : {} },
}]

let earlier = (name: string, asked: string) =>
  `This answers the ${name} asked at ${asked}, which was still running when ` +
  'it answered:\n'

/** The door's half: the call, run in the object for its key, and its answer
 * as the caller hears it. */
export let outlasted = async (
  objects: Outlasts,
  key: string,
  asked: Asked,
  progress?: string,
): Promise<Bundle[]> => {
  let name = asked.tool
  let heard = await objects.get(objects.idFromName(key)).call(asked)
  if ('running' in heard) {
    let { running, doing } = heard
    return said(
      (doing
        ? `${name} asked at ${running} is still running: ${doing}.`
        : progress ??
          `${name} asked at ${running} is still running, and goes on.`) +
        ' ' +
        `Call ${name} again with the same arguments to wait for it and hear ` +
        'how it ended.',
      { running: true, asked: running, ...doing ? { doing } : {} },
      asked.call,
    )
  }
  let before = heard.late ? earlier(name, heard.asked) : ''
  if ('refused' in heard) {
    throw new CallError(heard.refused.code, before + heard.refused.text)
  }
  return heard.said.map((b) => {
    let content = b.content as { body?: string } | undefined
    return before && content
      ? { ...b, content: { ...content, body: before + (content.body ?? '') } }
      : b
  })
}
