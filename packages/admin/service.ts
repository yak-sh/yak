// The box's watch over yaks.app, as one service with two looks: the deploy
// catch-up each minute, and the usage watch each hour (usage.ts). One process
// takes it, under the `@yaks/admin` lease.
//
// The deploy catch-up (catchup.ts decides; this looks and acts) reads
// main's head from origin; once that head is late, it reads what
// yak serves from wrangler, and compares the two in this checkout's git
// through the build's watch paths. Wrangler is asked only about a late head
// that is not yet live: its OAuth refresh rewrites one shared file without a
// lock (deploys.ts `deploymentLists`), so its readers stay rare. Whether
// Builds is running the head's build, or when it failed, is read from the
// check run Builds keeps on the commit in GitHub, `Workers Builds: yak`, which
// is in progress from the moment the build runs until it ends. `gh` reads it
// as the box's own GitHub sign-in, where Builds' own API would take one more
// credential, a Workers CI token.
//
// The build is started through main's deploy hook, a URL that can do nothing
// but start that build, kept in the vault and named by the config. The
// commit's `rebuilt` mark is written before the hook is asked, so a crash
// between the two never starts a second build; a look that fails is reported
// once until a look succeeds again.
//
// A deploy is timed from the same reads: wrangler's deployments say when each
// commit went live, and a commit's push to main is when GitHub made its first
// check suite, which it does as the push arrives; the box's own first sight
// of a head is a minute coarse. yaks.app's home page is asked a few times
// apart, since a fresh deploy can leave it cold for seconds.

import { checkout } from './checkout.ts'
import type { Comp, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { Interrupted } from '@yaks/tools/errors'
import type { Host } from '@yaks/host'
import { sleep } from '@yaks/fp'
import { WATCHED } from '../../workers/yak/wrangler.ts'
import {
  BOUND,
  type Build,
  type Deployed,
  down,
  firstShown,
  type Head,
  LATE,
  type Live,
  missed,
  PENDING,
  ran,
  said,
  slow,
  type Step,
  step,
  stuck,
  WINDOW,
} from './catchup.ts'
import {
  command,
  debuts,
  type Deployment,
  git,
  needGit,
  rowsIn,
  serving,
  shaIn,
  wrangler,
} from './deploys.ts'
import {
  type Answer,
  HOUR,
  jumps,
  QUERY,
  readings,
  report as jumped,
  variables,
} from './usage.ts'
import { ask, said as answered } from '../../workers/yak/analytics.ts'
import { Unavailable } from '../../workers/yak/workers_api.ts'

/** How long the service waits between looks at main. */
export let EVERY = 60_000

export type Options = {
  /** main's deploy hook, `{"secret": "BUILD_HOOK"}` in the config */
  hook?: string
  /** ms between looks at main (default {@link EVERY}) */
  every?: number
  /** ms a push may go with no build under way (default {@link LATE}) */
  late?: number
  /** ms main's head may take to go live once its build was asked for
   * (default {@link BOUND}) */
  bound?: number
  /** a Cloudflare token that reads the account's analytics,
   * `{"secret": "CF_USAGE_TOKEN"}` in the config, read at each hour's look;
   * a look without one passes its hour */
  analytics?: string
  /** the Cloudflare account the usage watch reads */
  account?: string
}

/** A commit's first deployment: its sha, and when it went live (ms). */
export type Debut = { sha: string; at: number }

/** Where the catch-up reads and acts: the box's own ({@link box}), or a
 * test's. */
export type Doors = {
  /** main's head at origin, and when origin first showed it (ms) */
  main: () => Promise<{ sha: string; at: number }>
  /** what yak serves, and each commit its recent deployments put live with
   * when the first of them did (ms) */
  live: () => Promise<Omit<Live, 'has'> & { debuts: Debut[] }>
  /** when a commit was pushed to main (ms), if GitHub has seen it */
  pushed: (sha: string) => Promise<number | undefined>
  /** whether yaks.app's home page answers 200: nothing, or why it does not */
  answers: () => Promise<string | undefined>
  /** whether two commits hold the same Worker source */
  same: (a: string, b: string) => Promise<boolean>
  /** whether Workers Builds is running a build of a commit, or when it
   * failed */
  build: (sha: string) => Promise<Build>
  /** start main's build, and say what Builds answered */
  start: () => Promise<string>
  now: () => number
  /** the pause between looks, cut short by shutdown */
  wait: (ms: number, signal: AbortSignal) => Promise<void>
}

type Report = NonNullable<Host['report']>

let SHA = /^[0-9a-f]{40}\b/

/** The check run Workers Builds keeps on a commit it builds for `yak`. */
let CHECK = 'Workers Builds: yak'

/** The page a visitor lands on, asked `TRIES` times `APART` before it counts
 * as not answering: a deploy leaves it cold for seconds (on 2026-10-28 probes
 * timed out at 5 s, then answered in 2.6 s and 0.04 s). */
let SITE = 'https://yaks.app/'
let TRIES = 3
let APART = 10_000

/** yaks.app's home page, asked once: nothing when it answers 200, else why
 * not. Shutdown cutting the ask off is no answer. */
let home = async (go: typeof fetch, stopping: AbortSignal) => {
  try {
    let r = await go(SITE, {
      redirect: 'manual',
      signal: AbortSignal.any([stopping, AbortSignal.timeout(10_000)]),
    })
    await r.body?.cancel()
    return r.status == 200 ? undefined : `HTTP ${r.status}`
  } catch (error) {
    if (stopping.aborted) throw new Interrupted('shut down', 'signal')
    return error instanceof Error ? error.message : String(error)
  }
}

/** The box's doors: origin and this checkout's git, wrangler, the hook. */
export let box = (
  options: Options,
  stopping: AbortSignal,
  dir = checkout,
  go: typeof fetch = fetch,
): Doors => {
  let run = (args: string[]) => needGit(dir, args, stopping)
  let wrangled = async (args: string[]) =>
    JSON.parse(await wrangler(dir, [...args, '--json'], stopping))
  // A commit this checkout lacks comes with its trees, never its blobs.
  let have = async (sha: string) => {
    if ((await git(dir, ['cat-file', '-e', `${sha}^{commit}`], stopping)).ok) {
      return
    }
    await run([
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--filter=blob:none',
      'origin',
      sha,
    ])
  }
  // A head's landing is its push, which git does not date: the commit's own
  // time is when it was made, minutes before a land's gate lets it be pushed.
  // Looked at each minute, the first look that shows a head is its push to
  // within the look. A process that starts with a head already there starts
  // its clock then.
  let shown = firstShown()
  return {
    main: async () => {
      let sha = SHA.exec(await run(['ls-remote', 'origin', 'refs/heads/main']))
        ?.[0]
      if (!sha) throw new Error('origin has no main')
      await have(sha)
      return shown(sha)
    },
    live: async () => {
      let rows = rowsIn<Deployment>(
        await wrangled(['deployments', 'list']),
        'deployments',
      )
      let now = serving(rows)
      if (!now) throw new Error('yak has no deployment')
      let sha = now.sha
      if (!sha) {
        let raw = await wrangled(['versions', 'view', now.version])
        sha = shaIn((raw.result ?? raw).annotations?.['workers/message'])
      }
      if (!sha) {
        throw new Error(`yak serves ${now.version}, which names no commit`)
      }
      return {
        sha,
        at: Date.parse(now.at),
        rollback: now.rollback,
        debuts: debuts(rows).map((d) => ({ ...d, at: Date.parse(d.at) })),
      }
    },
    pushed: async (sha) => {
      let at = Date.parse(
        await command(
          dir,
          'gh',
          [
            'api',
            `repos/{owner}/{repo}/commits/${sha}/check-suites`,
            '--jq',
            '[.check_suites[].created_at] | min',
          ],
          stopping,
        ),
      )
      return Number.isFinite(at) ? at : undefined
    },
    answers: async () => {
      for (let tries = 1;; tries++) {
        let problem = await home(go, stopping)
        if (!problem || tries == TRIES) return problem
        await sleep(APART, stopping)
      }
    },
    same: async (a, b) => {
      await have(a)
      await have(b)
      let r = await git(
        dir,
        ['diff', '--quiet', a, b, '--', ...WATCHED],
        stopping,
      )
      if (r.code != 0 && r.code != 1) {
        throw new Error(`git diff exited ${r.code}: ${r.err.trim()}`)
      }
      return r.code == 0
    },
    build: async (sha) => {
      let runs = `repos/{owner}/{repo}/commits/${sha}/check-runs?check_name=` +
        encodeURIComponent(CHECK)
      let run = await command(
        dir,
        'gh',
        [
          'api',
          runs,
          '--jq',
          '.check_runs[0] | {status, conclusion, completed_at}',
        ],
        stopping,
      )
      return ran(JSON.parse(run))
    },
    start: async () => {
      let hook = options.hook
      if (!hook) return 'no deploy hook is configured, so none was started'
      try {
        let r = await go(hook, {
          method: 'POST',
          signal: AbortSignal.any([stopping, AbortSignal.timeout(20_000)]),
        })
        return said(r.status, await r.json().catch(() => null))
      } catch {
        // A transport error can carry the hook's URL, which is its credential.
        return 'the deploy hook could not be reached'
      }
    },
    now: Date.now,
    wait: sleep,
  }
}

let time = (c?: Comp) => c?.at ? Date.parse(String(c.at)) : undefined

/** One look at main: the head it found and what it did about it. A head
 * already `settled` (live, held or given up on) is passed over unread. */
export let pass = async (
  g: Graph,
  doors: Doors,
  report: Report,
  { late = LATE, bound = BOUND }: Pick<Options, 'late' | 'bound'> = {},
  settled?: string,
): Promise<{ sha: string; step: Step }> => {
  let tip = await doors.main()
  if (tip.sha == settled) return { sha: tip.sha, step: 'done' }
  let [row] = await g.get([tip.sha])
  let mark = row?.rebuilt as Comp | undefined
  let head: Head = { ...tip, rebuilt: time(mark), failed: !!row?.failed }
  let next = step(head, doors.now(), undefined, late, bound)
  if (next != 'look') return { sha: tip.sha, step: next }
  let { debuts: shown, ...served } = await doors.live()
  let live: Live = {
    ...served,
    has: served.sha == tip.sha || await doors.same(served.sha, tip.sha),
  }
  if (!live.has) head = { ...head, ...await doors.build(tip.sha) }
  next = step(head, doors.now(), live, late, bound)
  let context = (fault: string, answer: string) => ({
    fault: `${fault}:yak`,
    commit: tip.sha,
    tags: { worker: 'yak', live: live.sha, builds: answer },
  })
  if (next == 'rebuild') {
    try {
      await g.apply([{
        entity: { eid: tip.sha },
        $was: { rebuilt: { at: null } },
        rebuilt: {},
      }])
    } catch (error) {
      // Another look took this commit's one start.
      if (error instanceof Stale) return { sha: tip.sha, step: 'done' }
      throw error
    }
    let answer = await doors.start()
    await g.apply([{ entity: { eid: tip.sha }, rebuilt: { said: answer } }])
    // A pending build is a slow one, not a miss.
    if (answer != PENDING) {
      await report(
        missed(head, live, answer, late, bound),
        context('deploy missed', answer),
      )
    }
  }
  if (next == 'fail') {
    let answer = String(mark?.said ?? 'unsaid')
    let error = stuck(head, live, answer, bound)
    await g.apply([{
      entity: { eid: tip.sha },
      failed: { reason: error.message },
    }])
    await report(error, context('deploy stuck', answer))
  }
  let fresh = await untimed(g, shown)
  let timed = await measure(g, doors, fresh)
  let slower = timed.length ? slow(await latest(g)) : undefined
  if (slower) {
    await report(slower, {
      fault: 'deploy slow:yak',
      commit: timed.at(-1)!.sha,
      tags: { worker: 'yak' },
    })
  }
  // The head's own deploy, first seen: not a push that changed no Worker
  // source, nor a look after the head was settled.
  if (fresh.some((d) => d.sha == tip.sha)) {
    let problem = await doors.answers()
    if (problem) {
      await report(down(tip.sha, problem), {
        fault: 'deploy down:yak',
        commit: tip.sha,
        tags: { worker: 'yak', live: live.sha },
      })
    }
  }
  return { sha: tip.sha, step: next }
}

let iso = (ms: number) => new Date(ms).toISOString()

/** The deploys a look shows that have no `deployed` yet. */
let untimed = async (g: Graph, shown: Debut[]): Promise<Debut[]> => {
  if (!shown.length) return []
  let had = new Set(
    (await g.get(shown.map((d) => d.sha), ['deployed']))
      .filter((row) => row.deployed).map((row) => row.entity.eid),
  )
  return shown.filter((d) => !had.has(d.sha))
}

/** Times each deploy, oldest first, and answers the ones it timed. A commit
 * GitHub has no push of, or one pushed after it went live, is left untimed. */
let measure = async (
  g: Graph,
  doors: Doors,
  fresh: Debut[],
): Promise<Deployed[]> => {
  let timed: Deployed[] = []
  for (let { sha, at } of fresh) {
    let pushed = await doors.pushed(sha)
    if (pushed != null && pushed <= at) timed.push({ sha, pushed, live: at })
  }
  if (timed.length) {
    await g.apply(timed.map((d) => ({
      entity: { eid: d.sha },
      deployed: { pushed: iso(d.pushed), live: iso(d.live) },
    })))
  }
  return timed
}

/** main's latest timed deploys, the window `slow` judges. */
let latest = async (g: Graph): Promise<Deployed[]> =>
  (await g.read(`.deployed .order=-deployed.live .limit=${WINDOW}`))
    .map((row) => {
      let d = row.deployed as Comp
      return {
        sha: row.entity.eid,
        pushed: Date.parse(String(d.pushed)),
        live: Date.parse(String(d.live)),
      }
    })

let SETTLED: Step[] = ['live', 'held', 'done']

/** Look at main every {@link EVERY}, and at the last hour's usage once an
 * hour, until shutdown; or each once with an aborted signal, the way a
 * one-shot command runs a service. */
export let service = async (
  host: { graph: Graph } & Pick<Host, 'report'>,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  doors: Doors = box(options, signal),
  usage: Usage = analytics(options),
): Promise<void> => {
  let report: Report = async (error, context) => {
    try {
      if (host.report) await host.report(error, context)
      else console.error('@yaks/admin —', error)
    } catch { /* a report that fails cannot stop the next look */ }
  }
  await Promise.all([
    catchUp(host.graph, options, signal, doors, report),
    watch(usage, signal, doors, report),
  ])
}

let catchUp = async (
  g: Graph,
  options: Options,
  signal: AbortSignal,
  doors: Doors,
  report: Report,
) => {
  let settled: string | undefined
  let failing = false
  for (;;) {
    try {
      let done = await pass(g, doors, report, options, settled)
      if (SETTLED.includes(done.step)) settled = done.sha
      failing = false
    } catch (error) {
      // A look cut off by shutdown has not failed. A dead wrangler sign-in is
      // one report, not one a minute.
      if (!(error instanceof Interrupted)) {
        if (!failing) {
          await report(error, { tags: { duty: 'deploy catch-up' } })
        }
        failing = true
      }
    }
    if (signal.aborted) return
    await doors.wait(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}

/** Where the usage watch reads: the account's analytics for an hour (ms, on
 * the hour) and the two days before it, nothing while it has no token to read
 * them with, or no account to read at all. */
export type Usage =
  | ((hour: number) => Promise<Answer | undefined>)
  | undefined

/** Cloudflare's analytics, with the token read each time it is asked, so a
 * token that could not be read for one look is read again for the next. */
export let analytics = (options: Options): Usage =>
  options.account
    ? async (hour) => {
      let token = options.analytics
      if (!token) return undefined
      let data = answered(
        await ask<Answer>(
          { CF_ANALYTICS_TOKEN: token },
          QUERY,
          variables(options.account!, hour),
        ),
      )
      if (!data) throw new Error('analytics answered no data')
      return data
    }
    : undefined

/** How long after an hour ends its analytics are read: Cloudflare's datasets
 * hold an hour within minutes of its end. */
export let SETTLE = 10 * 60_000

/** How long Cloudflare's analytics may go unanswered before the usage watch
 * reports it: one look after the first that failed, each riding out about
 * eight seconds of resends (workers/yak/workers_api.ts `resent`). */
export let OUTAGE = 5 * EVERY

/** One look at an hour's usage: every jump it finds, reported, or none
 * without a token to look with. */
export let look = async (
  usage: NonNullable<Usage>,
  report: Report,
  hour: number,
) => {
  let answer = await usage(hour)
  if (!answer) return []
  let { series, who } = readings(answer)
  let found = jumps(series, hour)
  for (let jump of found) {
    let { error, context } = jumped(jump, who.get(jump.subject))
    await report(error, context)
  }
  return found
}

let watch = async (
  usage: Usage,
  signal: AbortSignal,
  doors: Pick<Doors, 'now' | 'wait'>,
  report: Report,
) => {
  if (!usage) return
  // Since the last look that succeeded: when the first that failed began, and
  // whether the failing has been reported.
  let done = -Infinity, down: number | undefined, told = false
  for (;;) {
    let hour = Math.floor((doors.now() - SETTLE) / HOUR) * HOUR - HOUR
    if (hour > done) {
      let at = doors.now()
      try {
        await look(usage, report, hour)
        done = hour
        down = undefined
        told = false
      } catch (error) {
        // The next look asks for the same hour, and the failing is one report
        // until a look succeeds again. A look Cloudflare could not answer
        // (`Unavailable`, its own failure through every resend) is a line in
        // the log until none has been answered for OUTAGE; any other failure
        // is reported at once. A look with no token passes its hour, so a
        // token that cannot be read is asked for once an hour.
        down ??= at
        let outage = error instanceof Unavailable
        if (outage && doors.now() - down < OUTAGE) {
          console.warn(`@yaks/admin — usage watch: ${String(error)}`)
        } else if (!told) {
          told = true
          let since = new Date(down).toISOString()
          await report(
            outage
              ? Error(
                `Cloudflare's analytics has not answered since ${since}`,
                {
                  cause: error,
                },
              )
              : error,
            { tags: { duty: 'usage watch' } },
          )
        }
      }
    }
    if (signal.aborted) return
    await doors.wait(5 * EVERY, signal)
    if (signal.aborted) return
  }
}
