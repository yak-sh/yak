// The deploy catch-up: what to do when main's head is not live. Every push to
// main is meant to deploy yaks.app through Workers Builds, and sometimes
// Builds starts no build at all (739f56b25, T-123970). Nothing then reports a
// failure, because nothing failed: main and production quietly disagree until
// the next push. So the box looks (service.ts), and this decides.
//
// A head gets `LATE` to go live, since Builds starts a build within seconds of
// a push. Past it, a head Builds is still building waits: its build is under
// way, only slower than LATE. A head whose build failed waits a `BOUND` from
// the failure: Workers Builds tells the kernel (workers/yak/builds.ts), which
// builds main again through the deploy hook, a build no check run shows, and
// files that build's failure; a look that started a second build beside it
// would only race it. Otherwise the catch-up asks main's deploy hook for a
// build once, marking the commit `rebuilt{said}` with what Builds answered.
// The hook starts none while one is queued or initializing, so a build that is
// merely waiting its turn costs nothing and is not reported; a build the hook
// did start is. The hook would start a second build beside a running one
// (Cloudflare's deploy hooks page), which is why a running one is read first.
// A `BOUND` later, still not live, the catch-up marks the commit
// `failed{reason}`, reports that, and starts nothing more for it: the build's
// own log says why, and the next push starts over. A rollback newer than the
// head is an operator's choice and is left alone. Removing the marks asks for
// another try.
//
// A look that reads what is live also times the deploys it shows: each
// commit's first deployment, from its push to main to the moment yaks.app
// served it, kept on the commit as `deployed{pushed, live}`. The latest
// `WINDOW` of them are judged together, and a median past `SLOW` is reported
// as deploys that got slower, a bug of its own. Once main's head goes live
// through its own deploy, yaks.app's home page has to answer 200; one that
// does not is reported too.

import { median } from './usage.ts'

/** How long a push may go not live before the catch-up looks for its build.
 * Builds queues one within seconds of the push, and a build of `yak` took 78 s
 * at the median (248 successful ones, 2026-10-11 to 13); on 2026-10-27 pushes
 * went live 3 to 5 minutes after they landed, behind each other's builds.
 * Looking early costs nothing while the head's build runs (it waits) or is
 * queued (the hook answers `already_exists`). On 2026-10-21 two pushes got no
 * build at all, during and after a GitHub webhook delay, and waited 15 minutes
 * for the catch-up. */
export let LATE = 3 * 60_000

/** How long main's head may take to go live once its build was asked for:
 * longer than any build measured. Of those 248 builds, 277 s at the 99th
 * percentile and 789 s at most; push to live as main's gate recorded it, to
 * 2026-10-21, was 50 s at the median and 640 s at most. */
export let BOUND = 15 * 60_000

/** main's head: its commit, when origin first showed it (ms), whether Workers
 * Builds is running a build of it or when that build failed (ms, once read),
 * and when the catch-up started its build and gave up on it, if it has. */
export type Head = {
  sha: string
  at: number
  building?: boolean
  broke?: number
  rebuilt?: number
  failed?: boolean
}

/** What Workers Builds says of a head's build, once read. */
export type Build = Pick<Head, 'building' | 'broke'>

/** The check run Workers Builds keeps on a commit, as GitHub gives it. */
export type Run = {
  status?: string | null
  conclusion?: string | null
  completed_at?: string | null
}

/// ran({ status: 'in_progress' }) -> { building: true }
/// ran({ status: 'queued' }) -> { building: true }
/// ran({ status: 'completed', conclusion: 'failure', completed_at: '2026-10-28T12:59:40Z' }) -> { broke: 1793192380000 }
/// ran({ status: 'completed', conclusion: 'success' }) -> {}
/// ran({ status: null, conclusion: null, completed_at: null }) -> {}
/** What a commit's latest check run says of its build: under way until it
 * completes, or failed at its completion. A build that passed, or was
 * cancelled, says nothing: no failure path rebuilds it. */
export let ran = (run: Run): Build =>
  !run.status
    ? {}
    : run.status != 'completed'
    ? { building: true }
    : run.conclusion == 'failure' && run.completed_at
    ? { broke: Date.parse(run.completed_at) }
    : {}

/** What serves: the commit its deployment was built from, when it went live
 * (ms), whether an operator rolled back to it, and whether it already has the
 * head's Worker source (wrangler.ts `WATCHED`). */
export type Live = { sha: string; at: number; rollback: boolean; has: boolean }

/** Dates each head by the first look that shows it (`now` in ms): the time of
 * the head's push, to within a look. */
export let firstShown = (now: () => number = Date.now) => {
  let first: { sha: string; at: number } | undefined
  return (sha: string) => first?.sha == sha ? first : first = { sha, at: now() }
}

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
/// step({ ...h, building: true }, LATE, l) -> 'wait'
/// step({ ...h, broke: LATE }, LATE + BOUND - 1, l) -> 'wait'
/// step({ ...h, broke: LATE }, LATE + BOUND, l) -> 'rebuild'
/// step(h, LATE, { ...l, at: 1, rollback: true }) -> 'held'
/// step({ ...h, rebuilt: BOUND }, BOUND + LATE) -> 'wait'
/// step({ ...h, rebuilt: BOUND, building: true }, 2 * BOUND, l) -> 'wait'
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
    : head.building || now - live.at < (head.rebuilt ? bound : late) ||
        now - (head.broke ?? -Infinity) < bound
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
export let missed = (
  head: Head,
  live: Live,
  answer: string,
  late = LATE,
  bound = BOUND,
) =>
  new NotLive(
    `main's head ${short(head.sha)} is not live ${
      head.broke
        ? `${minutes(bound)} after its Workers Build failed`
        : `${minutes(late)} after it was pushed`
    }; yak serves ${short(live.sha)}. ${
      head.broke
        ? 'No build of main deployed it since'
        : 'No Workers Build of it is running or deployed it'
    }, so the deploy catch-up started main's build through its deploy ` +
      `hook: ${answer}`,
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

/** A deploy of main as the catch-up timed it: its commit, when the commit was
 * pushed to main, and when yaks.app first served it (ms). */
export type Deployed = { sha: string; pushed: number; live: number }

/** How many of main's latest deploys are judged together. One deploy says
 * little: Cloudflare's build alone varied 27 to 97 s from one push to the next
 * (T-131399) with nothing in the repo changed. */
export let WINDOW = 10

/** The median push to live past which deploys got slower: about twice what
 * one takes. The nine before 2026-10-28T14:02Z went live 56 to 96 s after
 * their push, 65 s at the median, besides one whose build failed and was built
 * again (322 s); from 10-10 to 10-21 they took 27 to 96 s, 63 s at the
 * median. */
export let SLOW = 2 * 60_000

/** Deploys that got slower: the error the tracker is handed. */
export class Slow extends Error {
  override name = 'Slow'
}

let seconds = (ms: number) => `${Math.round(ms / 1000)} s`

/// let at = (s: number, i: number) => ({ sha: `${i}abcdef0`, pushed: i * 600_000, live: i * 600_000 + s * 1000 })
/// slow([60, 70, 80].map(at), 3) -> undefined
/// slow([60, 130, 300].map(at), 3)?.message -> "main's deploys got slower: push to live took 130 s at the median of the last 3, past 120 s. Newest first: 2abcdef0 300 s, 1abcdef0 130 s, 0abcdef0 60 s"
/// slow([300, 300].map(at), 3) -> undefined
/** Whether main's deploys got slower: the median push to live of the latest
 * `window` past `bound`. Fewer than a window say nothing yet. */
export let slow = (rows: Deployed[], window = WINDOW, bound = SLOW) => {
  let latest = rows.toSorted((a, b) => b.live - a.live).slice(0, window)
  let took = (d: Deployed) => d.live - d.pushed
  let typical = median(latest.map(took))
  return latest.length < window || typical <= bound ? undefined : new Slow(
    `main's deploys got slower: push to live took ${
      seconds(typical)
    } at the median of the last ${window}, past ${seconds(bound)}. ` +
      `Newest first: ${
        latest.map((d) => `${short(d.sha)} ${seconds(took(d))}`).join(', ')
      }`,
  )
}

/** yaks.app not answering once main's head went live: the error the tracker
 * is handed. */
export class Down extends Error {
  override name = 'Down'
}

/// down('739f56b25cae820c8541a8b4a1ade2f7a6c7e9be', 'HTTP 503').message -> "yaks.app's home page did not answer 200 once main's head 739f56b2 went live: HTTP 503"
/** Why yaks.app's home page failed the head that just went live. */
export let down = (sha: string, problem: string) =>
  new Down(
    `yaks.app's home page did not answer 200 once main's head ${
      short(sha)
    } went live: ${problem}`,
  )
