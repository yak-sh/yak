// The deploy catch-up as a service (catchup.ts decides; this looks and acts).
// One process takes it, under the `@yaks/admin` lease. Each minute it reads
// main's head from origin; once that head has had its bound, it reads what
// yak serves from wrangler, and compares the two in this checkout's git
// through the build's watch paths. Wrangler is asked once per head, not once a
// minute: its OAuth refresh rewrites one shared file without a lock
// (deploys.ts `deploymentLists`), so its readers stay rare.
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
  type Head,
  type Live,
  missed,
  said,
  type Step,
  step,
  stuck,
} from './catchup.ts'
import {
  type Deployment,
  git,
  needGit,
  rowsIn,
  serving,
  shaIn,
  wrangler,
} from './deploys.ts'

/** How long the service waits between looks at main. */
export let EVERY = 60_000

export type Options = {
  /** main's deploy hook, `{"secret": "BUILD_HOOK"}` in the config */
  hook?: string
  /** ms between looks at main (default {@link EVERY}) */
  every?: number
  /** ms main's head may take to go live (default {@link BOUND}) */
  bound?: number
}

/** Where the catch-up reads and acts: the box's own ({@link box}), or a
 * test's. */
export type Doors = {
  /** main's head at origin, and when it landed (ms) */
  main: () => Promise<{ sha: string; at: number }>
  /** what yak serves */
  live: () => Promise<Omit<Live, 'has'>>
  /** whether two commits hold the same Worker source */
  same: (a: string, b: string) => Promise<boolean>
  /** start main's build, and say what Builds answered */
  start: () => Promise<string>
  now: () => number
  /** the pause between looks, cut short by shutdown */
  wait: (ms: number, signal: AbortSignal) => Promise<void>
}

type Report = NonNullable<Host['report']>

let SHA = /^[0-9a-f]{40}\b/

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
  return {
    main: async () => {
      let sha = SHA.exec(await run(['ls-remote', 'origin', 'refs/heads/main']))
        ?.[0]
      if (!sha) throw new Error('origin has no main')
      await have(sha)
      return {
        sha,
        at: Date.parse(await run(['show', '-s', '--format=%cI', sha])),
      }
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
  bound: number = BOUND,
  settled?: string,
): Promise<{ sha: string; step: Step }> => {
  let tip = await doors.main()
  if (tip.sha == settled) return { sha: tip.sha, step: 'done' }
  let [row] = await g.get([tip.sha])
  let mark = row?.rebuilt as Comp | undefined
  let head: Head = { ...tip, rebuilt: time(mark), failed: !!row?.failed }
  let next = step(head, doors.now(), undefined, bound)
  if (next != 'look') return { sha: tip.sha, step: next }
  let served = await doors.live()
  let live: Live = {
    ...served,
    has: served.sha == tip.sha || await doors.same(served.sha, tip.sha),
  }
  next = step(head, doors.now(), live, bound)
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
    await report(
      missed(head, live, answer, bound),
      context('deploy missed', answer),
    )
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

/** Look at main every {@link EVERY} until shutdown, or once with an aborted
 * signal, the way a one-shot command runs a service. */
export let service = async (
  host: { graph: Graph } & Pick<Host, 'report'>,
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  doors: Doors = box(options, signal),
): Promise<void> => {
  let report: Report = async (error, context) => {
    try {
      if (host.report) await host.report(error, context)
      else console.error('@yaks/admin deploy catch-up —', error)
    } catch { /* a report that fails cannot stop the next look */ }
  }
  let settled: string | undefined
  let failing = false
  for (;;) {
    try {
      let done = await pass(
        host.graph,
        doors,
        report,
        options.bound,
        settled,
      )
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
