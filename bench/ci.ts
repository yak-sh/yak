/** Tells the tracker when a CI workflow is broken on main, so @yaks/heal sends
 * it to an agent like any other bug. Monitoring, not a gate. Each workflow
 * reports under one fault, so a workflow that stays red adds hits to its open
 * bug, and one that goes red again after its bug was resolved reopens it.
 *
 * A red run is broken: a check or a test failed. What a test took fails
 * nothing (bin/test-budget.ts). A red run on a commit that lacks the fix its
 * workflow's bug was resolved with is the failure that fix explains, so it is
 * dropped rather than reopening the bug.
 *
 *   deno run -A bench/ci.ts [--tracker=<url>] [workflow ...]
 *
 * Cron runs it through bin/ci-monitor. Each workflow's newest run seen is
 * kept in `~/.cache/yak/ci/monitor.json`. */

import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'

export let WORKFLOWS = ['gate', 'publish']

/** The fault each workflow's failures group under: one bug per workflow. */
let fault = (workflow: string) => `ci failed: ${workflow}`

export type Run = {
  databaseId: number
  conclusion: string
  displayTitle: string
  headSha: string
  url: string
}

/** Each workflow's newest run seen. */
export type Seen = Record<string, number>

/** Reports new failures since the latest success, oldest first, and repeats
 * the current failure until fixed. `runs` answers a workflow's newest finished
 * runs. A listing whose newest run is older than the newest seen is not main's
 * present (GitHub answers so at times) and reports nothing. A failure
 * `explained` says the workflow's resolved bug already accounts for is not
 * reported. */
export let watch = async (
  workflows: string[],
  seen: Seen,
  runs: (workflow: string) => Promise<Run[]>,
  report: (error: Error, workflow: string, run: Run) => Promise<void>,
  explained: (workflow: string, run: Run) => Promise<boolean> = () =>
    Promise.resolve(false),
): Promise<Seen> => {
  let next = { ...seen }
  for (let workflow of workflows) {
    let rows = (await runs(workflow)).toSorted((a, b) =>
      b.databaseId - a.databaseId
    )
    let since = next[workflow] ?? 0
    if (!rows.length || rows[0].databaseId < since) continue
    let green = rows.findIndex((r) => r.conclusion == 'success')
    // A cancelled or skipped run says nothing either way.
    let failures = rows.slice(0, green < 0 ? rows.length : green)
      .filter((r) => r.conclusion == 'failure')
    let red = failures.filter((r, i) => i == 0 || r.databaseId > since)
    for (let run of red.reverse()) {
      if (await explained(workflow, run)) continue
      await report(
        new Error(
          `${workflow} failed on main: ${run.displayTitle} (${
            run.headSha.slice(0, 9)
          }) ${run.url}`,
        ),
        workflow,
        run,
      )
    }
    next[workflow] = rows[0].databaseId
  }
  return next
}

let gh = async (...args: string[]) => {
  let { stdout, success } = await new Deno.Command('gh', {
    args,
    stdout: 'piped',
  }).output()
  if (!success) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed`)
  return new TextDecoder().decode(stdout)
}

export let recent = async (workflow: string): Promise<Run[]> =>
  JSON.parse(
    await gh(
      'run',
      'list',
      '--workflow',
      workflow,
      '--branch',
      'main',
      '--status',
      'completed',
      '--limit',
      '10',
      '--json',
      'databaseId,conclusion,displayTitle,headSha,url',
    ),
  )

/** The commit a workflow's bug was resolved with, from the tracker at `url`;
 * none while the bug is open, resolved without a commit, or out of reach. */
export let resolvedFix = async (
  url: string,
  workflow: string,
): Promise<string | undefined> => {
  let q = `.bug.fault=${JSON.stringify(fault(workflow))} .resolved`
  try {
    let response = await fetch(`${url}/query?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return
    let [bug] = await response.json()
    return bug?.resolved?.fix || undefined
  } catch {
    return
  }
}

/** Whether `commit` contains `fix`; a commit Git cannot place counts as
 * containing it, so its failure is still reported. */
export let contains = async (commit: string, fix: string): Promise<boolean> => {
  let { code } = await new Deno.Command('git', {
    args: ['merge-base', '--is-ancestor', fix, commit],
    stdout: 'null',
    stderr: 'null',
  }).output()
  return code != 1
}

/** A failure the workflow's resolution explains: its commit predates the fix.
 * Each workflow's fix is read once per pass. */
export let predates = (
  fixOf: (workflow: string) => Promise<string | undefined>,
  has: (commit: string, fix: string) => Promise<boolean>,
) => {
  let fixes = new Map<string, Promise<string | undefined>>()
  return async (workflow: string, run: Run): Promise<boolean> => {
    if (!fixes.has(workflow)) fixes.set(workflow, fixOf(workflow))
    let fix = await fixes.get(workflow)
    return !!fix && !(await has(run.headSha, fix))
  }
}

/// stored({ gate: 9, publish: 7 }) -> { gate: 9, publish: 7 }
/// stored({ seen: { gate: 9 }, held: {} }) -> { gate: 9 }
/// stored(null) -> {}
/** What was seen, as kept, or as the watcher kept it beside the runs it held
 * for a test's time. */
export let stored = (kept: unknown): Seen => {
  let o = kept && typeof kept == 'object' ? kept as Record<string, unknown> : {}
  return ('seen' in o ? o.seen : o) as Seen
}

if (import.meta.main) {
  let file = `${Deno.env.get('HOME') ?? '/tmp'}/.cache/yak/ci/monitor.json`
  let state = stored(
    await Deno.readTextFile(file).then((t) => JSON.parse(t)).catch(() => null),
  )
  let path = configPath()
  let send = reporter(path ? read(path) : {}, undefined, revision(), {
    command: 'ci',
  })
  let named = Deno.args.filter((a) => !a.startsWith('--'))
  let tracker = Deno.args.find((a) => a.startsWith('--tracker='))
    ?.slice('--tracker='.length) ?? 'http://127.0.0.1:5175'
  let next = await watch(
    named.length ? named : WORKFLOWS,
    state,
    recent,
    (error, workflow, run) =>
      send(error, {
        fault: fault(workflow),
        // The code that failed is the run's, not this checkout's.
        commit: run.headSha,
        during: { kind: 'ci' },
        tags: { job: 'ci', workflow },
      }),
    predates((workflow) => resolvedFix(tracker, workflow), contains),
  )
  await send.close()
  await Deno.mkdir(file.replace(/\/[^/]+$/, ''), { recursive: true })
  await Deno.writeTextFile(file, JSON.stringify(next, null, 2) + '\n')
}
