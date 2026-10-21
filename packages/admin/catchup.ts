// The deploy catch-up: what to do when main's head is not live. Every push to
// main is meant to deploy yaks.app through Workers Builds, and sometimes
// Builds starts no build at all (739f56b25, T-123970). Nothing then reports a
// failure, because nothing failed: main and production quietly disagree until
// the next push. So the box looks (service.ts), and this decides.
//
// A head gets `LATE` to have its build under way, since Builds starts one
// within seconds of a push. Past it, the catch-up asks main's deploy hook for
// a build once, marking the commit `rebuilt{said}` with what Builds answered.
// The hook starts none while one is pending, so a build that is merely slow
// costs nothing and is not reported; a build the hook did start is. A `BOUND`
// later, still not live, the catch-up marks the
// commit `failed{reason}`, reports that, and starts nothing more for it: the
// build's own log says why, and the next push starts over. A rollback newer
// than the head is an operator's choice and is left alone. Removing the marks
// asks for another try.

/** How long a push may go with no build under way. Builds queues one within
 * seconds of the push, and a build of `yak` takes 78 s at the median (248
 * successful ones, 2026-10-11 to 13). Asking early costs one more build of the
 * same commit at worst, and none while one is pending (the hook answers
 * `already_exists`). On 2026-10-21 two pushes got no build at all, during and
 * after a GitHub webhook delay, and waited 15 minutes for the catch-up. */
export let LATE = 3 * 60_000

/** How long main's head may take to go live once its build was asked for:
 * longer than any build measured. Of those 248 builds, 277 s at the 99th
 * percentile and 789 s at most; push to live in bench/deploys.jsonl is 50 s at
 * the median, 640 s at most. */
export let BOUND = 15 * 60_000

/** main's head: its commit, when it landed (ms), and when the catch-up
 * started its build and gave up on it, if it has. */
export type Head = {
  sha: string
  at: number
  rebuilt?: number
  failed?: boolean
}

/** What serves: the commit its deployment was built from, when it went live
 * (ms), whether an operator rolled back to it, and whether it already has the
 * head's Worker source (wrangler.ts `WATCHED`). */
export type Live = { sha: string; at: number; rollback: boolean; has: boolean }

/** What a pass does about the head: nothing yet (`wait`), read what is live
 * (`look`), nothing at all (`live`, `held`, `done`), start main's build
 * (`rebuild`), or give up on it (`fail`). */
export type Step =
  | 'wait'
  | 'look'
  | 'live'
  | 'held'
  | 'done'
  | 'rebuild'
  | 'fail'

/// let h = { sha: 'b', at: 0 }
/// let l = { sha: 'a', at: -60_000, rollback: false, has: false }
/// step(h, 60_000) -> 'wait'
/// step(h, LATE) -> 'look'
/// step(h, LATE, { ...l, has: true }) -> 'live'
/// step(h, LATE, l) -> 'rebuild'
/// step(h, LATE, { ...l, at: 1, rollback: true }) -> 'held'
/// step({ ...h, rebuilt: BOUND }, BOUND + LATE) -> 'wait'
/// step({ ...h, rebuilt: BOUND }, 2 * BOUND, l) -> 'fail'
/// step({ ...h, rebuilt: BOUND, failed: true }, 9 * BOUND, l) -> 'done'
/** What to do about main's head at `now`, given what is live once read. */
export let step = (
  head: Head,
  now: number,
  live?: Live,
  late: number = LATE,
  bound: number = BOUND,
): Step =>
  head.failed
    ? 'done'
    : now - Math.max(head.at, head.rebuilt ?? 0) < (head.rebuilt ? bound : late)
    ? 'wait'
    : !live
    ? 'look'
    : live.has
    ? 'live'
    : live.rollback && live.at > head.at
    ? 'held'
    : now - live.at < (head.rebuilt ? bound : late)
    ? 'wait'
    : head.rebuilt
    ? 'fail'
    : 'rebuild'

type Answer = {
  success?: boolean
  errors?: { message?: string }[]
  result?: { already_exists?: boolean; build_uuid?: string; status?: string }
}

/// said(200, { success: true, result: { build_uuid: 'aa194fb5-5e63', status: 'queued' } }) -> 'build aa194fb5 queued'
/// said(200, { success: true, result: { already_exists: true } }) -> PENDING
/// said(404, { success: false, errors: [{ message: 'Not found' }] }) -> 'refused 404: Not found'
/** What the deploy hook says when a build of main is already queued or
 * running: the head's build exists and is only slow. */
export let PENDING = 'a pending build of main already exists'

/** What Workers Builds answered a deploy hook, in words. */
export let said = (status: number, body: unknown): string => {
  let a = (body && typeof body == 'object' ? body : {}) as Answer
  let why = a.errors?.map((e) => e.message).filter(Boolean).join('; ')
  return status >= 300 || !a.success
    ? `refused ${status}${why ? `: ${why}` : ''}`
    : a.result?.already_exists
    ? PENDING
    : `build ${a.result?.build_uuid?.slice(0, 8) ?? '(no id)'} ${
      a.result?.status ?? 'started'
    }`
}

/** A main commit that did not go live: the error the tracker is handed. */
export class NotLive extends Error {
  override name = 'NotLive'
}

let short = (sha: string) => sha.slice(0, 8)
let minutes = (ms: number) => `${Math.round(ms / 60_000)} min`

/** Why the catch-up started main's build, with what Builds answered. */
export let missed = (head: Head, live: Live, answer: string, late = LATE) =>
  new NotLive(
    `main's head ${short(head.sha)} is not live ${
      minutes(late)
    } after it landed; yak serves ${short(live.sha)}. No Workers Build ` +
      `deployed it, so the deploy catch-up started main's build through its ` +
      `deploy hook: ${answer}`,
  )

/** Why the catch-up gave up on a commit whose build it started. */
export let stuck = (head: Head, live: Live, answer: string, bound = BOUND) =>
  new NotLive(
    `main's head ${short(head.sha)} is still not live ${
      minutes(bound)
    } after the deploy catch-up started its build (${answer}); yak serves ` +
      `${short(live.sha)}. It starts no other build of this commit; the ` +
      `build's log says why it did not deploy.`,
  )
