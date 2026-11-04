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
// build once, marking the commit `rebuilt{said}` with what Builds answered
// (workers/yak/hook.ts reads the answer for the kernel's rebuild too).
// The hook starts none while one is queued or initializing, so a build that is
// merely waiting its turn costs nothing. A build the hook did start is
// reported only for a failure of ours (`ours`). A head whose own build passed
// and is not live is one: an older build went live over it. A head Builds
// started no build for is not, alone: Cloudflare drops a push now and then
// (8d466e6b and eabd1bb6 on 2026-10-21, fde2d0aa on 2026-11-04: GitHub made
// the Cloudflare app's check suite, yet neither `yak` nor `yak-tracker` built,
// and Builds kept no record of the push), and the build just started recovers
// it. When the catch-up also started the build of the Worker source change
// before the head, two pushes in a row went unbuilt: Builds stopped building
// pushes (its trigger, watch paths or repo connection), and that is reported.
// A failed build is the kernel's to file, and a start that still does not
// deploy is reported below. The hook would start a second build beside a
// running one (Cloudflare's deploy hooks page), which is why a running one
// is read first.
// An ask the hook answered with the pending build started nothing, so when
// that pending build fails (Builds times out one that never left
// initializing) and the kernel's rebuild does not deploy it either, the
// catch-up asks again a `BOUND` from the failure, as for any failed build.
// A `BOUND` after a start, still not live, the catch-up marks the commit
// `failed{reason}`, reports that, and starts nothing more for it: the build's
// own log says why, and the next push starts over. A rollback newer than the
// head is an operator's choice and is left alone. Removing the marks asks for
// another try.
//
// A look that reads what is live also times the deploys it shows: each
// commit's first deployment, from the moment the deploy door began it in
// Workers Builds to the moment yaks.app served it, kept on the commit as
// `deployed{began, live}`. That is the part of a deploy this repo makes fast
// or slow (bundling, installing, uploading). Before it, Builds may hold the
// build: on 2026-11-03 0057e019 and 367ab6c4 waited 498 and 564 s for a build
// environment and 27 to 87 s more for Cloudflare's clone and cache, then went
// live 63 and 47 s after the door began. A wait we cannot shorten is no bug of
// ours, so it is not timed. The latest `WINDOW` deploys are judged together,
// and a median past `SLOW` is reported as deploys that got slower, a bug of
// its own. Once main's head goes live
// through its own deploy, yaks.app's home page has to answer 200; one that
// does not is reported too.

import { median } from './usage.ts'
import { PENDING } from '../../workers/yak/hook.ts'

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
 * Builds is running a build of it, when that build failed (ms) or whether it
 * passed, and the Worker source change before the one its build deploys
 * (each once read), when the catch-up asked for its build, whether the hook
 * deferred that ask to a pending build, and whether the catch-up gave up on
 * it. */
export type Head = {
  sha: string
  at: number
  building?: boolean
  broke?: number
  passed?: boolean
  prior?: string
  rebuilt?: number
  deferred?: boolean
  failed?: boolean
}

/** What Workers Builds says of a head's build, and the change before it, once
 * read. */
export type Build = Pick<Head, 'building' | 'broke' | 'passed' | 'prior'>

/** The check run Workers Builds keeps on a commit, as GitHub gives it. */
export type Run = {
  status?: string | null
  conclusion?: string | null
  completed_at?: string | null
}

/// ran({ status: 'in_progress' }) -> { building: true }
/// ran({ status: 'queued' }) -> { building: true }
/// ran({ status: 'completed', conclusion: 'failure', completed_at: '2026-10-28T12:59:40Z' }) -> { broke: 1793192380000 }
/// ran({ status: 'completed', conclusion: 'success' }) -> { passed: true }
/// ran({ status: 'completed', conclusion: 'cancelled' }) -> {}
/// ran({ status: null, conclusion: null, completed_at: null }) -> {}
/** What a commit's latest check run says of its build: under way until it
 * completes, then failed at its completion or passed. A cancelled build, or
 * none, says nothing. */
export let ran = (run: Run): Build =>
  !run.status
    ? {}
    : run.status != 'completed'
    ? { building: true }
    : run.conclusion == 'failure' && run.completed_at
    ? { broke: Date.parse(run.completed_at) }
    : run.conclusion == 'success'
    ? { passed: true }
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
/// let d = { ...h, rebuilt: BOUND, deferred: true }
/// step({ ...d, broke: BOUND + 1 }, 2 * BOUND, l) -> 'wait'
/// step({ ...d, broke: BOUND + 1 }, 2 * BOUND + 1, l) -> 'rebuild'
/// step({ ...d, broke: BOUND - 1 }, 2 * BOUND, l) -> 'fail'
/// step(d, 2 * BOUND, l) -> 'fail'
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
    : head.rebuilt && !(head.deferred && (head.broke ?? 0) > head.rebuilt)
    ? 'fail'
    : 'rebuild'

/** A main commit that did not go live: the error the tracker is handed. */
export class NotLive extends Error {
  override name = 'NotLive'
}

let short = (sha: string) => sha.slice(0, 8)
let minutes = (ms: number) => `${Math.round(ms / 60_000)} min`

/// let pushed = { sha: 'fde2d0aaab27', at: 0, prior: '5569fa814681' }
/// let started = 'build 0333e0df queued'
/// let pending = 'a pending build of main already exists'
/// ours(pushed, started, undefined) -> false
/// ours(pushed, started, 'build 87942fdf queued') -> true
/// ours(pushed, started, pending) -> false
/// ours({ ...pushed, passed: true }, started, undefined) -> true
/// ours({ ...pushed, passed: true }, pending, undefined) -> false
/// ours({ ...pushed, broke: 1 }, started, 'build 87942fdf queued') -> false
/** Whether the build the catch-up just started for `head`, which Builds
 * answered with `answer`, stands for a failure of ours, given what Builds
 * answered when the catch-up started the build of the Worker source change
 * before it (`before`, if it did). A head whose own build passed and is not
 * live is one; a head Builds started no build for is one when the change
 * before it went unbuilt too, and otherwise a push Cloudflare dropped. A
 * start the hook deferred to a pending build started nothing, and a failed
 * build is the kernel's to file. */
export let ours = (head: Head, answer: string, before?: string) =>
  answer != PENDING && !head.broke &&
  (!!head.passed || (before != null && before != PENDING))

/// let served = { sha: '5569fa814681', at: 0, rollback: false, has: false }
/// missed(pushed, served, started).message -> "main's head fde2d0aa is not live 3 min after it was pushed; yak serves 5569fa81. No Workers Build of it is running or deployed it, so the deploy catch-up started main's build through its deploy hook (build 0333e0df queued), as it did for the Worker source change before it (5569fa81). Builds started no build for either push: check the yak trigger's branch, watch paths and repo connection."
/// missed({ ...pushed, passed: true }, served, started).message -> "main's head fde2d0aa is not live 3 min after it was pushed, though its Workers Build passed; yak serves 5569fa81, so the deploy catch-up started main's build through its deploy hook (build 0333e0df queued). An older build went live after it, or its deploy put nothing live."
/** Why the catch-up started main's build, with what Builds answered: the
 * head's own build passed and is not live, or Builds built neither it nor
 * the Worker source change before it. */
export let missed = (head: Head, live: Live, answer: string, late = LATE) =>
  new NotLive(
    head.passed
      ? `main's head ${short(head.sha)} is not live ${
        minutes(late)
      } after it was pushed, though its Workers Build passed; yak serves ` +
        `${short(live.sha)}, so ` +
        `the deploy catch-up started main's build through its deploy hook ` +
        `(${answer}). An older build went live after it, or its deploy put ` +
        `nothing live.`
      : `main's head ${short(head.sha)} is not live ${
        minutes(late)
      } after it was pushed; yak serves ${short(live.sha)}. No Workers ` +
        `Build of it is running or deployed it, so the deploy catch-up ` +
        `started main's build through its deploy hook (${answer}), as it ` +
        `did for the Worker source change before it${
          head.prior ? ` (${short(head.prior)})` : ''
        }. Builds started no build for either push: check the yak trigger's ` +
        `branch, watch paths and repo connection.`,
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

/** A deploy of main as the catch-up timed it: its commit, when the deploy
 * door began it, and when yaks.app first served it (ms). */
export type Deployed = { sha: string; began: number; live: number }

/** How many of main's latest deploys are judged together. One deploy says
 * little: of 58 on 2026-11-04, the deploy command to live took 31 to 96 s
 * with nothing in the repo changed between neighbours. */
export let WINDOW = 10

/** The median from the door's start to live past which deploys got slower:
 * about twice what one takes. Those 58 deploys took 50 s at the median and
 * 62 s at the 90th percentile. */
export let SLOW = 2 * 60_000

/** Deploys that got slower: the error the tracker is handed. */
export class Slow extends Error {
  override name = 'Slow'
}

let seconds = (ms: number) => `${Math.round(ms / 1000)} s`

/// let at = (s: number, i: number) => ({ sha: `${i}abcdef0`, began: i * 600_000, live: i * 600_000 + s * 1000 })
/// slow([60, 70, 80].map(at), 3) -> undefined
/// slow([60, 130, 300].map(at), 3)?.message -> "main's deploys got slower: a deploy took 130 s from its start to live at the median of the last 3, past 120 s. Newest first: 2abcdef0 300 s, 1abcdef0 130 s, 0abcdef0 60 s"
/// slow([300, 300].map(at), 3) -> undefined
/** Whether main's deploys got slower: the median from start to live of the
 * latest `window` past `bound`. Fewer than a window say nothing yet. */
export let slow = (rows: Deployed[], window = WINDOW, bound = SLOW) => {
  let latest = rows.toSorted((a, b) => b.live - a.live).slice(0, window)
  let took = (d: Deployed) => d.live - d.began
  let typical = median(latest.map(took))
  return latest.length < window || typical <= bound ? undefined : new Slow(
    `main's deploys got slower: a deploy took ${
      seconds(typical)
    } from its start to live at the median of the last ${window}, past ${
      seconds(bound)
    }. ` +
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
