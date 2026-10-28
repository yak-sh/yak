/** Tells the tracker when a CI workflow is broken on main, so @yaks/heal sends
 * it to an agent like any other bug. Monitoring, not a gate. Each workflow
 * reports under one fault, so a workflow that stays red adds hits to its open
 * bug, and one that goes red again after its bug was resolved reopens it.
 *
 * A red run is broken when a check or a test failed, and is reported at once.
 * A run red only for a time is held: a test over its budget or past its
 * record (bin/test-budget.ts). The gate's runner shares its CPU's cache and
 * memory with the agents' box, so a test that sits near its line can be over
 * it every time it is measured while the box is busy, and not on the next
 * run, with no change to its code. A held run is reported when the next run
 * that times the same thing is over it again, and dropped with a line in the
 * log when the next run passes. A test the code made slow is over on every
 * run, so it reports one run later; a blip never does. A red run the watcher
 * cannot read is broken.
 *
 *   deno run -A bench/ci.ts [workflow ...]
 *
 * Cron runs it through bin/ci-monitor. What it has seen and holds is kept in
 * `~/.cache/yak/ci/monitor.json`. */

import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'
import { type Budget, failed, read as kept } from '../bin/test-budget.ts'

export let WORKFLOWS = ['gate', 'publish']

export type Run = {
  databaseId: number
  conclusion: string
  displayTitle: string
  headSha: string
  url: string
}

/** What a red run says: broken, or over the times it names. */
export type Verdict = { broken: true } | { broken: false; over: string[] }

/** A red run held for the next run's word, and what it was over. */
export type Held = { run: number; over: string[] }

/** Each workflow's newest run seen, and the red run it holds. */
export type State = {
  seen: Record<string, number>
  held: Record<string, Held>
}

let BROKEN: Verdict = { broken: true }

/// verdict(['deno task check']) -> { broken: true }
/// verdict(['tests'], { code: 0, over: ['a_test.ts: x'] }) -> { broken: false, over: ['a_test.ts: x'] }
/// verdict(['tests'], { code: 1, over: ['a_test.ts: x'] }) -> { broken: true }
/// verdict(['tests'], { code: 0, over: [] }) -> { broken: true }
/// verdict(['tests']) -> { broken: true }
/// verdict([]) -> { broken: true }
/** What a red run's failed steps say, with what its tests step kept: the
 * suite's own exit code, and what the budget failed. A tests step whose
 * tests passed and whose budget failed nothing failed for a reason this
 * cannot see, so it is broken. */
export let verdict = (
  steps: string[],
  tests?: { code: number; over: string[] },
): Verdict => {
  let [step, ...more] = steps
  if (!step || more.length) return BROKEN
  return step == 'tests' && tests && !tests.code && tests.over.length
    ? { broken: false, over: tests.over }
    : BROKEN
}

/** Reports what each workflow's runs since `state` say is broken, and holds a
 * run red only for a time until the next run says whether it stays. `runs`
 * answers a workflow's newest finished runs, newest first. */
export let watch = async (
  workflows: string[],
  state: State,
  runs: (workflow: string) => Promise<Run[]>,
  judged: (workflow: string, run: Run) => Promise<Verdict>,
  report: (error: Error, workflow: string) => Promise<void>,
  note: (line: string) => void = console.log,
): Promise<State> => {
  let seen = { ...state.seen }, held = { ...state.held }
  for (let workflow of workflows) {
    let rows = await runs(workflow)
    let said = (run: Run, why = '') =>
      report(
        new Error(
          `${workflow} failed on main: ${run.displayTitle} (${
            run.headSha.slice(0, 9)
          }) ${run.url}${why}`,
        ),
        workflow,
      )
    let since = seen[workflow] ?? 0
    for (let run of rows.filter((r) => r.databaseId > since).reverse()) {
      let was = held[workflow]
      if (run.conclusion == 'success') {
        if (was) {
          note(
            `${workflow} ${was.run} was over only once: ${run.databaseId} passed`,
          )
        }
        delete held[workflow]
        continue
      }
      // A cancelled or skipped run says nothing either way.
      if (run.conclusion != 'failure') continue
      let v = await judged(workflow, run)
      let again = v.broken ? [] : v.over.filter((o) => was?.over.includes(o))
      if (v.broken || again.length) {
        await said(run, again.length ? `, over again: ${again.join('; ')}` : '')
        delete held[workflow]
      } else {
        held[workflow] = { run: run.databaseId, over: v.over }
        note(
          `${workflow} ${run.databaseId} is red only for ${
            v.over.join('; ')
          }: held for the next run`,
        )
      }
    }
    let top = rows[0]?.databaseId
    if (top) seen[workflow] = Math.max(top, seen[workflow] ?? 0)
  }
  return { seen, held }
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

// The names of a run's failed steps, and what its tests step kept: the
// suite-timings artifact holds the times it judged (bench/test-times).
let failedSteps = async (run: Run): Promise<string[]> =>
  (await gh(
    'run',
    'view',
    String(run.databaseId),
    '--json',
    'jobs',
    '--jq',
    '.jobs[].steps[] | select(.conclusion == "failure") | .name',
  )).split('\n').filter(Boolean)

// The times are held to the list the run's own commit holds: the list only
// shrinks, so today's would call a test it still listed unlisted.
let listAt = async (sha: string): Promise<Budget> => {
  let { stdout, success } = await new Deno.Command('git', {
    args: ['show', `${sha}:bench/test-budget.json`],
    stdout: 'piped',
    stderr: 'null',
  }).output()
  if (!success) throw new Error(`no bench/test-budget.json at ${sha}`)
  return JSON.parse(new TextDecoder().decode(stdout))
}

let testsKept = async (run: Run) => {
  let dir = await Deno.makeTempDir({ prefix: 'ci-watch-' })
  try {
    await gh(
      'run',
      'download',
      String(run.databaseId),
      '--name',
      'suite-timings',
      '--dir',
      dir,
    )
    let m = await kept(`${dir}/test-times`)
    return { code: m.code, over: failed(await listAt(run.headSha), m) }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

// A run this cannot read is broken: it is never held on a guess.
export let verdictOf = async (_: string, run: Run): Promise<Verdict> => {
  try {
    let steps = await failedSteps(run)
    return verdict(
      steps,
      steps[0] == 'tests' ? await testsKept(run) : undefined,
    )
  } catch (error) {
    console.error(`could not read run ${run.databaseId}:`, error)
    return BROKEN
  }
}

/// stored({ gate: 9, publish: 7 }) -> { seen: { gate: 9, publish: 7 }, held: {} }
/// stored({ seen: { gate: 9 }, held: {} }) -> { seen: { gate: 9 }, held: {} }
/// stored(null) -> { seen: {}, held: {} }
/** The state as kept, or as the watcher kept it before it held runs: each
 * workflow's newest run seen, alone. */
export let stored = (kept: unknown): State => {
  let o = kept && typeof kept == 'object' ? kept as Record<string, unknown> : {}
  return 'seen' in o
    ? { held: {}, ...o } as State
    : { seen: o as Record<string, number>, held: {} }
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
    verdictOf,
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
