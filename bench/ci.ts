/** Tells the tracker when a CI workflow is red on main, so @yaks/heal sends it
 * to an agent like any other bug. Monitoring, not a gate. Each workflow
 * reports under one fault, so a workflow that stays red adds hits to its open
 * bug, and one that goes red again after its bug was resolved reopens it. A
 * run is reported once.
 *
 *   deno run -A bench/ci.ts [workflow ...]
 *
 * Cron runs it through bin/ci-monitor. What it last reported is kept in
 * `~/.cache/yak/ci/monitor.json`. */

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
export type Seen = Record<string, number>

/// red([{databaseId: 2, conclusion: 'failure'}], 1)?.databaseId -> 2
/// red([{databaseId: 2, conclusion: 'failure'}], 2) -> undefined
/// red([{databaseId: 2, conclusion: 'success'}], 1) -> undefined
/// red([], 0) -> undefined
/** The newest finished run when it failed and has not been reported yet. */
export let red = (
  runs: Partial<Run>[],
  seen: number,
): Partial<Run> | undefined => {
  let [last] = runs
  return last?.conclusion == 'failure' && last.databaseId! > seen
    ? last
    : undefined
}

/** Reports each red workflow once; returns what it has now seen. */
export let watch = async (
  workflows: string[],
  seen: Seen,
  runs: (workflow: string) => Promise<Partial<Run>[]>,
  report: (error: Error, workflow: string) => Promise<void>,
): Promise<Seen> => {
  let now = { ...seen }
  for (let workflow of workflows) {
    let rows = await runs(workflow)
    let run = red(rows, seen[workflow] ?? 0)
    if (run) {
      await report(
        new Error(
          `${workflow} failed on main: ${run.displayTitle} (${
            run.headSha?.slice(0, 9)
          }) ${run.url}`,
        ),
        workflow,
      )
    }
    let top = rows[0]?.databaseId
    if (top) now[workflow] = Math.max(top, now[workflow] ?? 0)
  }
  return now
}

let gh = async (workflow: string): Promise<Run[]> => {
  let { stdout, success } = await new Deno.Command('gh', {
    args: [
      'run',
      'list',
      '--workflow',
      workflow,
      '--branch',
      'main',
      '--status',
      'completed',
      '--limit',
      '1',
      '--json',
      'databaseId,conclusion,displayTitle,headSha,url',
    ],
    stdout: 'piped',
  }).output()
  if (!success) throw new Error(`gh run list failed for ${workflow}`)
  return JSON.parse(new TextDecoder().decode(stdout))
}

if (import.meta.main) {
  let state = `${Deno.env.get('HOME') ?? '/tmp'}/.cache/yak/ci/monitor.json`
  let seen: Seen = {}
  try {
    seen = JSON.parse(await Deno.readTextFile(state))
  } catch { /* first run */ }
  let path = configPath()
  let send = reporter(path ? read(path) : {}, undefined, revision(), {
    command: 'ci',
  })
  let named = Deno.args.filter((a) => !a.startsWith('--'))
  let next = await watch(
    named.length ? named : WORKFLOWS,
    seen,
    gh,
    (error, workflow) =>
      send(error, {
        fault: `ci failed: ${workflow}`,
        during: { kind: 'ci' },
        tags: { job: 'ci', workflow },
      }),
  )
  await send.close()
  await Deno.mkdir(state.replace(/\/[^/]+$/, ''), { recursive: true })
  await Deno.writeTextFile(state, JSON.stringify(next, null, 2) + '\n')
}
