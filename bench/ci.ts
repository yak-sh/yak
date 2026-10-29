/** Tells the tracker when a CI workflow is broken on main, so @yaks/heal sends
 * it to an agent like any other bug. Monitoring, not a gate. Each workflow
 * reports under one fault, so a workflow that stays red adds hits to its open
 * bug, and one that goes red again after its bug was resolved reopens it.
 *
 * A red run is broken: a check or a test failed. What a test took fails
 * nothing (bin/test-budget.ts).
 *
 *   deno run -A bench/ci.ts [workflow ...]
 *
 * Cron runs it through bin/ci-monitor. Each workflow's newest run seen is
 * kept in `~/.cache/yak/ci/monitor.json`. */

import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'

export let WORKFLOWS = ['gate', 'publish']

export type Run = {
  databaseId: number
  conclusion: string
  displayTitle: string
  headSha: string
  url: string
}

/** Each workflow's newest run seen. */
export type Seen = Record<string, number>

/** Reports each red run of each workflow since `seen`, oldest first. `runs`
 * answers a workflow's newest finished runs, newest first. */
export let watch = async (
  workflows: string[],
  seen: Seen,
  runs: (workflow: string) => Promise<Run[]>,
  report: (error: Error, workflow: string) => Promise<void>,
): Promise<Seen> => {
  let next = { ...seen }
  for (let workflow of workflows) {
    let rows = await runs(workflow)
    let since = next[workflow] ?? 0
    // A cancelled or skipped run says nothing either way.
    let red = rows.filter((r) =>
      r.databaseId > since && r.conclusion == 'failure'
    )
    for (let run of red.reverse()) {
      await report(
        new Error(
          `${workflow} failed on main: ${run.displayTitle} (${
            run.headSha.slice(0, 9)
          }) ${run.url}`,
        ),
        workflow,
      )
    }
    let top = rows[0]?.databaseId
    if (top) next[workflow] = Math.max(top, next[workflow] ?? 0)
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
  let next = await watch(
    named.length ? named : WORKFLOWS,
    state,
    recent,
    (error, workflow) =>
      send(error, {
        fault: `ci failed: ${workflow}`,
        during: { kind: 'ci' },
        tags: { job: 'ci', workflow },
      }),
  )
  await send.close()
  await Deno.mkdir(file.replace(/\/[^/]+$/, ''), { recursive: true })
  await Deno.writeTextFile(file, JSON.stringify(next, null, 2) + '\n')
}
