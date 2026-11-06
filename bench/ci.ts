/** Tells the tracker when a CI workflow is broken on main, so @yaks/heal sends
 * it to an agent like any other bug. Monitoring, not a gate.
 *
 * A red run is broken: a check or a test failed. What a test took fails
 * nothing (bin/test-budget.ts). Its report names what failed, read from the
 * run's log, and the commit that broke it: of the commits after the newest
 * success up to the first red run, the newest that changed where a failing
 * test lives, else that run's own. A red streak reports under one fault, that
 * commit's, so a workflow that stays red adds hits to its open bug, and each
 * new breakage is a bug of its own. The report names the session that landed
 * the commit and the task it was for, from the box's `commit{target}` row and
 * its `created.via`, as the failure's `during{session, entity}`: heal sends the
 * bug to that session while it is at work, else to a fixer on that task.
 *
 * A red run on a commit that lacks the fix its bug was resolved with is the
 * failure that fix explains, so it is dropped rather than reopening the bug.
 *
 *   deno run -A bench/ci.ts [--tracker=<url>] [--box=<url>] [workflow ...]
 *
 * Cron runs it every minute through bin/ci-monitor. Each workflow's newest run
 * seen is kept in `~/.cache/yak/ci/monitor.json`. */

import { configPath, read } from '../packages/cli/config.ts'
import { reporter, revision } from '../packages/cli/report.ts'
import { member } from '../bin/test-changes.ts'

export let WORKFLOWS = ['gate', 'publish']

/** The fault a workflow's failures group under: one bug per commit that
 * broke it. */
let fault = (workflow: string, commit: string) =>
  `ci failed: ${workflow} since ${commit}`

export type Run = {
  databaseId: number
  conclusion: string
  displayTitle: string
  headSha: string
  url: string
}

/** Each workflow's newest run seen. */
export type Seen = Record<string, number>

/** A red streak: its oldest failure since the newest success, and that
 * success, when the listing reaches it. */
export type Streak = { first: Run; green?: Run }

/** Reports new failures since the latest success, oldest first, and repeats
 * the current failure until fixed, each with its streak. `runs` answers a
 * workflow's newest finished runs. A listing whose newest run is older than
 * the newest seen is not main's present (GitHub answers so at times) and
 * reports nothing. A failure `explained` says a resolved bug already accounts
 * for is not reported. */
export let watch = async (
  workflows: string[],
  seen: Seen,
  runs: (workflow: string) => Promise<Run[]>,
  report: (workflow: string, run: Run, streak: Streak) => Promise<void>,
  explained: (workflow: string, run: Run, streak: Streak) => Promise<boolean> =
    () => Promise.resolve(false),
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
    let streak = { first: failures.at(-1)!, green: rows[green] }
    for (let run of red.reverse()) {
      if (await explained(workflow, run, streak)) continue
      await report(workflow, run, streak)
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
      '30',
      '--json',
      'databaseId,conclusion,displayTitle,headSha,url',
    ),
  )

// The rows a graph at `url` answers `q` with; none when it is out of reach.
// A row as a graph's query door answers it: components by name.
type Row = Record<string, Record<string, unknown> | undefined>
let asked = async (url: string, q: string): Promise<Row[]> => {
  try {
    let response = await fetch(`${url}/query?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5_000),
    })
    return response.ok ? await response.json() : []
  } catch {
    return []
  }
}

/** The commit the bug of `fault` was resolved with, from the tracker at `url`;
 * none while the bug is open, resolved without a commit, or out of reach. */
export let resolvedFix = async (
  url: string,
  fault: string,
): Promise<string | undefined> => {
  let [bug] = await asked(url, `.bug.fault=${JSON.stringify(fault)} .resolved`)
  return (bug?.resolved?.fix as string | undefined) || undefined
}

/** Who landed `commit` and for what, from the box at `url`: its `commit` row's
 * task and the session it was created through. */
export let landed = async (
  url: string,
  commit: string,
): Promise<{ session?: string; task?: string }> => {
  let [row] = await asked(url, `.commit .entity.eid=${commit} ?created`)
  let session = row?.created?.via, task = row?.commit?.target
  return {
    ...session ? { session: String(session) } : {},
    ...task ? { task: String(task) } : {},
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

/** A failure its fault's resolution explains: its commit predates the fix.
 * Each fault's fix is read once per pass. */
export let predates = (
  fixOf: (fault: string) => Promise<string | undefined>,
  has: (commit: string, fix: string) => Promise<boolean>,
) => {
  let fixes = new Map<string, Promise<string | undefined>>()
  return async (fault: string, run: Run): Promise<boolean> => {
    if (!fixes.has(fault)) fixes.set(fault, fixOf(fault))
    let fix = await fixes.get(fault)
    return !!fix && !(await has(run.headSha, fix))
  }
}

/** A test or check that failed, and the file it lives in, when known. */
export type Failed = { name: string; file?: string }

// A line of `gh run view --log-failed`: its job, its step, a timestamp, then
// what the step printed.
let LINE = /^[^\t]*\t([^\t]*)\t\S+ ?(.*)$/

/// failing('g\ttests\t2026-11-06T10:58:20Z a test => ./w/a_test.ts:4:1\ng\ttests\t2026-11-06T10:58:21Z a test => ./w/a_test.ts:4:1')
///   -> [{ name: 'a test', file: 'w/a_test.ts' }]
/// failing('g\tcheck\tT FAILED | 8 passed | 2 failed: check:fmt, check:lint (3.1s)')
///   -> [{ name: 'check:fmt' }, { name: 'check:lint' }]
/// failing('g\tbuild\tT ##[error]Process completed with exit code 1.')
///   -> [{ name: 'build' }]
/** What failed in a run, from its failed steps' log: each test the runner's
 * errors name, each check the checks' closing line names, else each step that
 * failed. */
export let failing = (log: string): Failed[] => {
  let tests = new Map<string, Failed>(), steps = new Set<string>()
  for (let line of log.split('\n')) {
    let [, step, said] = line.match(LINE) ?? []
    if (said == undefined) continue
    let test = said.match(/^(.+) => \.\/(\S+?)(?::\d+:\d+)?$/)
    let checks = said.match(
      /^FAILED \| \d+ passed \| \d+ failed: (.+) \(\S+\)$/,
    )
    if (test) tests.set(said, { name: test[1], file: test[2] })
    else if (checks) {
      for (let name of checks[1].split(', ')) tests.set(name, { name })
    } else if (said.startsWith('##[error]')) steps.add(step)
  }
  return tests.size ? [...tests.values()] : [...steps].map((name) => ({ name }))
}

/** A commit on main and the paths it changed. */
export type Change = { sha: string; subject: string; paths: string[] }

/// changed('\0aaa\tFirst\n\nx/a.ts\nx/b.ts\n\0bbb\tSecond\n\ny/c.ts\n')
///   -> [{ sha: 'aaa', subject: 'First', paths: ['x/a.ts', 'x/b.ts'] }, { sha: 'bbb', subject: 'Second', paths: ['y/c.ts'] }]
/** Commits from `git log --format=%x00%H%x09%s --name-only`, newest first. */
export let changed = (log: string): Change[] =>
  log.split('\0').filter((c) => c.trim()).map((c) => {
    let [head, ...paths] = c.split('\n').filter(Boolean)
    let [sha, ...subject] = head.split('\t')
    return { sha, subject: subject.join('\t'), paths }
  })

let dir = (path: string) => path.replace(/\/?[^/]*$/, '')

/// let a = { sha: 'a', subject: '', paths: ['w/x.ts'] }, b = { sha: 'b', subject: '', paths: ['p/y.ts'] }
/// culprit([b, a], [{ name: 't', file: 'w/x_test.ts' }])?.sha -> 'a'
/// culprit([b, a], [{ name: 'check:fmt' }])?.sha -> 'b'
/// culprit([], [])?.sha -> undefined
/** The commit that broke `failed`, among `changes` newest first: the newest
 * that changed where a failing test lives (its package, by `owner`), else the
 * newest. */
export let culprit = (
  changes: Change[],
  failed: Failed[],
  owner: (path: string) => string | undefined = dir,
): Change | undefined => {
  let areas = failed.flatMap((f) =>
    f.file ? [owner(f.file) ?? dir(f.file)] : []
  )
  let touches = (c: Change) =>
    c.paths.some((p) => areas.some((a) => p == a || p.startsWith(`${a}/`)))
  return changes.find(touches) ?? changes[0]
}

/** What broke a red streak: the commit, the session that landed it and the
 * task it was for, when the box recorded them. */
export type Broke = Change & { session?: string; task?: string }

let MOST = 5

/// said('gate', { url: 'u' } as Run, { sha: 'abcdef0123', subject: 'Land it', paths: [] }, [{ name: 't', file: 'a_test.ts' }])
///   -> 'gate failed on main: t (a_test.ts); since abcdef012 (Land it) u'
/** A red run's report: what failed and the commit that broke it. */
export let said = (
  workflow: string,
  run: Run,
  broke: Change,
  failed: Failed[],
) => {
  let names = failed.slice(0, MOST)
    .map((f) => f.file ? `${f.name} (${f.file})` : f.name)
  let more = failed.length - names.length
  let what = names.length
    ? `${names.join('; ')}${more ? `; and ${more} more` : ''}`
    : 'see its log'
  return `${workflow} failed on main: ${what}; since ${
    broke.sha.slice(0, 9)
  } (${broke.subject}) ${run.url}`
}

/** What reporting a red run reads, and where it sends the report. */
export type Doors = {
  /** the log of a run's failed steps */
  log: (run: Run) => Promise<string>
  /** `git log --format=%x00%H%x09%s --name-only` after `from` up to `to` */
  history: (from: string | undefined, to: string) => Promise<string>
  /** who landed a commit and for what */
  landed: (commit: string) => Promise<{ session?: string; task?: string }>
  /** the commit the bug of a fault was resolved with */
  fixOf: (fault: string) => Promise<string | undefined>
  /** whether a commit contains another */
  has: (commit: string, fix: string) => Promise<boolean>
  send: (error: Error, context: Record<string, unknown>) => Promise<void>
}

/** A pass's `report` and `explained` for `watch`. Each run's log and each
 * streak's culprit are read once; a door that fails says nothing, and the run
 * is still reported. */
export let reporting = (doors: Doors) => {
  let once = <T>(
    memo: Map<number, Promise<T>>,
    id: number,
    read: () => Promise<T>,
  ) => {
    if (!memo.has(id)) memo.set(id, read())
    return memo.get(id)!
  }
  let logs = new Map<number, Promise<Failed[]>>()
  let failed = (run: Run) =>
    once(logs, run.databaseId, () => doors.log(run).then(failing, () => []))
  let blames = new Map<number, Promise<Broke>>()
  let blame = ({ first, green }: Streak) =>
    once(blames, first.databaseId, async () => {
      let changes = await doors.history(green?.headSha, first.headSha)
        .then(changed, () => [])
      let broke = culprit(changes, await failed(first), member) ??
        { sha: first.headSha, subject: first.displayTitle, paths: [] }
      return { ...broke, ...await doors.landed(broke.sha).catch(() => ({})) }
    })
  let fixed = predates(doors.fixOf, doors.has)
  return {
    explained: async (workflow: string, run: Run, streak: Streak) =>
      await fixed(fault(workflow, (await blame(streak)).sha), run),
    report: async (workflow: string, run: Run, streak: Streak) => {
      let broke = await blame(streak)
      await doors.send(
        new Error(said(workflow, run, broke, await failed(run))),
        {
          fault: fault(workflow, broke.sha),
          // The code that failed is the run's, not this checkout's.
          commit: run.headSha,
          during: {
            kind: 'ci',
            ...broke.session ? { session: broke.session } : {},
            ...broke.task ? { entity: broke.task } : {},
          },
          tags: { job: 'ci', workflow, since: broke.sha },
        },
      )
    },
  }
}

let output = async (command: string, args: string[]) => {
  let { stdout, success } = await new Deno.Command(command, {
    args,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  if (!success) throw new Error(`${command} ${args[0]} failed`)
  return new TextDecoder().decode(stdout)
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
  let config = path ? read(path) : {}
  let send = reporter(config, undefined, revision(), { command: 'ci' })
  let named = Deno.args.filter((a) => !a.startsWith('--'))
  let flag = (name: string) =>
    Deno.args.find((a) => a.startsWith(`--${name}=`))
      ?.slice(`--${name}=`.length)
  let tracker = flag('tracker') ?? 'http://127.0.0.1:5175'
  let box = flag('box') ?? `http://127.0.0.1:${config.port ?? 5173}`
  let { report, explained } = reporting({
    log: (run) =>
      output('gh', ['run', 'view', String(run.databaseId), '--log-failed']),
    history: (from, to) =>
      output('git', [
        'log',
        '--format=%x00%H%x09%s',
        '--name-only',
        ...from ? [`${from}..${to}`] : ['-1', to],
      ]),
    landed: (commit) => landed(box, commit),
    fixOf: (fault) => resolvedFix(tracker, fault),
    has: contains,
    send: (error, context) => send(error, context),
  })
  let next = await watch(
    named.length ? named : WORKFLOWS,
    state,
    recent,
    report,
    explained,
  )
  await send.close()
  await Deno.mkdir(file.replace(/\/[^/]+$/, ''), { recursive: true })
  await Deno.writeTextFile(file, JSON.stringify(next, null, 2) + '\n')
}
