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
// Builds is running the head's build is read from the check run Builds keeps
// on the commit in GitHub, `Workers Builds: yak`, which is in progress from
// the moment the build runs until it ends. `gh` reads it as the box's own
// GitHub sign-in, where Builds' own API would take one more credential, a
// Workers CI token.
//
// The build is started through main's deploy hook, a URL that can do nothing
// but start that build, kept in the vault and named by the config. The
// commit's `rebuilt` mark is written before the hook is asked, so a crash
// between the two never starts a second build; a look that fails is reported
// once until a look succeeds again.

import { checkout } from './checkout.ts'
import type { Comp, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { Interrupted } from '@yaks/tools/errors'
import type { Host } from '@yaks/host'
import { sleep } from '@yaks/fp'
import { WATCHED } from '../../workers/yak/wrangler.ts'
import {
  BOUND,
  firstShown,
  type Head,
  LATE,
  type Live,
  missed,
  PENDING,
  said,
  type Step,
  step,
  stuck,
} from './catchup.ts'
import {
  command,
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

/** Where the catch-up reads and acts: the box's own ({@link box}), or a
 * test's. */
export type Doors = {
  /** main's head at origin, and when origin first showed it (ms) */
  main: () => Promise<{ sha: string; at: number }>
  /** what yak serves */
  live: () => Promise<Omit<Live, 'has'>>
  /** whether two commits hold the same Worker source */
  same: (a: string, b: string) => Promise<boolean>
  /** whether Workers Builds is running a build of a commit */
  building: (sha: string) => Promise<boolean>
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
      let now = serving(
        rowsIn<Deployment>(
          await wrangled(['deployments', 'list']),
          'deployments',
        ),
      )
      if (!now) throw new Error('yak has no deployment')
      let sha = now.sha
      if (!sha) {
        let raw = await wrangled(['versions', 'view', now.version])
        sha = shaIn((raw.result ?? raw).annotations?.['workers/message'])
      }
      if (!sha) {
        throw new Error(`yak serves ${now.version}, which names no commit`)
      }
      return { sha, at: Date.parse(now.at), rollback: now.rollback }
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
    building: async (sha) => {
      let runs = `repos/{owner}/{repo}/commits/${sha}/check-runs?check_name=` +
        `${encodeURIComponent(CHECK)}&status=in_progress`
      let count = await command(
        dir,
        'gh',
        ['api', runs, '--jq', '.total_count'],
        stopping,
      )
      return Number(count) > 0
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
  let served = await doors.live()
  let live: Live = {
    ...served,
    has: served.sha == tip.sha || await doors.same(served.sha, tip.sha),
  }
  if (!live.has) head.building = await doors.building(tip.sha)
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
        missed(head, live, answer, late),
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
  return { sha: tip.sha, step: next }
}

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
  let done = -Infinity, failing = false
  for (;;) {
    let hour = Math.floor((doors.now() - SETTLE) / HOUR) * HOUR - HOUR
    if (hour > done) {
      try {
        await look(usage, report, hour)
        done = hour
        failing = false
      } catch (error) {
        // A failing look is one report until a look succeeds again, and the
        // next look asks for the same hour. A look with no token passes its
        // hour, so a token that cannot be read is asked for once an hour.
        if (!failing) await report(error, { tags: { duty: 'usage watch' } })
        failing = true
      }
    }
    if (signal.aborted) return
    await doors.wait(5 * EVERY, signal)
    if (signal.aborted) return
  }
}
