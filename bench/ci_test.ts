// The CI watcher (ci.ts) over runs on main: which red runs it reports, and
// what it blames each failure on.
import { equal, test } from '@yaks/testing'
import {
  type Doors,
  predates,
  reporting,
  type Run,
  type State,
  watch,
} from './ci.ts'

let CONCLUSION: Record<string, string> = {
  ok: 'success',
  cancelled: 'cancelled',
  skipped: 'skipped',
  red: 'failure',
}

let NONE: State = { seen: {}, red: {} }

let run = (id: number, conclusion: string, headSha = 'abc'): Run => ({
  databaseId: id,
  conclusion,
  displayTitle: headSha,
  headSha,
  url: `run/${id}`,
})

// Each tick finishes the runs it lists, oldest first, each by its id's
// order: `ok`, `cancelled` or `red`, on the commit of the same letter as its
// id (1 is a, 2 is b). GitHub lists the newest `listed`. Says the ids
// reported, tick by tick, unless `report` is given.
let play = async (
  ticks: string[][],
  { listed = Infinity, report }: {
    listed?: number
    report?: Parameters<typeof watch>[3]
  } = {},
) => {
  let all: Run[] = [], state = NONE, reported: number[] = []
  for (let tick of ticks) {
    for (let kind of tick) {
      let id = all.length + 1
      all.push(run(id, CONCLUSION[kind], String.fromCharCode(96 + id)))
    }
    state = await watch(
      ['gate'],
      state,
      () => Promise.resolve(all.toReversed().slice(0, listed)),
      report ?? ((_, run, __, blamed) => {
        reported.push(run.databaseId)
        return Promise.resolve(blamed)
      }),
    )
  }
  return reported
}

test('a newer success suppresses older failures in the same poll', async () => {
  equal(await play([['red', 'ok']]), [])
  equal(await play([['red', 'ok', 'red']]), [3])
  equal(await play([['red', 'ok', 'cancelled', 'skipped']]), [])
})

test('main staying red is reported on every poll until a success', async () => {
  equal(await play([['red'], [], ['cancelled', 'skipped'], ['ok'], []]), [
    1,
    1,
    1,
  ])
  equal(await play([['red', 'red'], [], ['ok', 'red'], []]), [1, 2, 2, 4, 4])
})

test('a success in one workflow does not suppress another workflow failing', async () => {
  let reported: string[] = []
  let rows = {
    gate: [run(3, 'success'), run(1, 'failure')],
    publish: [run(2, 'failure')],
  }
  let state = await watch(
    ['gate', 'publish'],
    NONE,
    (workflow) => Promise.resolve(rows[workflow as keyof typeof rows]),
    (workflow, _, __, blamed) => {
      reported.push(workflow)
      return Promise.resolve(blamed)
    },
  )
  equal(reported, ['publish'])
  equal(state.seen, { gate: 3, publish: 2 })
})

test('a listing older than the newest run seen reports nothing', async () => {
  let reported: number[] = []
  let report = (_: string, run: Run) => {
    reported.push(run.databaseId)
    return Promise.resolve({})
  }
  let nine = { seen: { gate: 9 }, red: {} }
  let state = await watch(
    ['gate'],
    nine,
    () => Promise.resolve([run(2, 'failure'), run(1, 'failure')]),
    report,
  )
  equal([reported, state.seen], [[], { gate: 9 }])
  state = await watch(
    ['gate'],
    nine,
    () => Promise.resolve([run(9, 'success'), run(10, 'failure')]),
    report,
  )
  equal([reported, state.seen], [[10], { gate: 10 }])
})

test('a failure on a commit before its resolution’s fix is explained by it', async () => {
  // Main is a line of commits a → b → c; the bug was resolved with fix b.
  let line = ['a', 'b', 'c']
  let has = (commit: string, fix: string) =>
    Promise.resolve(line.indexOf(commit) >= line.indexOf(fix))
  let fixed = (fix?: string) => (sha: string) =>
    predates(() => Promise.resolve(fix), has)('f', run(1, 'failure', sha))
  equal(await Promise.all(line.map(fixed('b'))), [true, false, false])
  equal(await fixed()('a'), false)
})

// Reports through `reporting`, whose doors answer from `logs` (the failing
// tests of a run by id, each `name file`), `commits` (each commit's paths) and
// `fix` (a fault's resolution); b was landed by session s for task t. Says
// each report's message, and the last one's context in `context`.
let context: Record<string, unknown> = {}
let told = async (
  ticks: string[][],
  logs: Record<number, string[]>,
  commits: Record<string, string[]>,
  { listed = Infinity, fix = {} as Record<string, string> } = {},
) => {
  let sent: string[] = [], order = Object.keys(commits)
  let doors: Doors = {
    log: (r) =>
      Promise.resolve(
        (logs[r.databaseId] ?? []).map((t) => {
          let [name, file] = t.split(' ')
          return `gate\ttests\tT ${name} => ./${file}:3:1`
        }).join('\n'),
      ),
    history: (from, to) =>
      Promise.resolve(
        order.slice(
          from ? order.indexOf(from) + 1 : order.indexOf(to),
          order.indexOf(to) + 1,
        )
          .toReversed()
          .map((sha) => `\0${sha}\t${sha}\n\n${commits[sha].join('\n')}\n`)
          .join(''),
      ),
    landed: (sha) =>
      Promise.resolve(sha == 'b' ? { session: 's', task: 't' } : {}),
    fixOf: (fault) => Promise.resolve(fix[fault]),
    has: (commit, fix) =>
      Promise.resolve(order.indexOf(commit) >= order.indexOf(fix)),
    send: (error, said) => {
      sent.push(error.message)
      context = said
      return Promise.resolve()
    },
  }
  await play(ticks, { listed, report: reporting(doors) })
  return sent
}

test('a red run names what failed and the commit that broke it, of those since the run before', async () => {
  // a is green; b touches w/, c touches p/, and the gate is red at c.
  equal(
    await told([['ok', 'cancelled', 'red']], { 3: ['lens w/lens_test.ts'] }, {
      a: [],
      b: ['w/x.ts'],
      c: ['p/y.ts'],
    }),
    ['gate failed on main: lens (w/lens_test.ts); since b (b) run/3'],
  )
  equal(context, {
    fault: 'ci failed: gate since b',
    commit: 'c',
    during: { kind: 'ci', session: 's', entity: 't' },
    tags: { job: 'ci', workflow: 'gate', since: 'b' },
  })
})

test('a breakage is blamed once, however long main stays red, and a new one is a bug of its own', async () => {
  // GitHub lists two runs, so from the second tick on it never reaches a,
  // the green. lens breaks at b and stays broken; cog breaks at d.
  let sent = await told(
    [['ok', 'red'], ['cancelled', 'red'], ['cancelled', 'red']],
    {
      2: ['lens w/lens_test.ts'],
      4: ['lens w/lens_test.ts', 'cog p/cog_test.ts'],
      6: ['cog p/cog_test.ts'],
    },
    {
      a: [],
      b: ['w/x.ts'],
      c: ['w/z.ts'],
      d: ['p/y.ts'],
      e: ['w/q.ts'],
      f: ['p/q.ts'],
    },
    { listed: 2 },
  )
  equal(sent, [
    'gate failed on main: lens (w/lens_test.ts); since b (b) run/2',
    'gate failed on main: lens (w/lens_test.ts); since b (b) run/4',
    'gate failed on main: cog (p/cog_test.ts); since d (d) run/4',
    'gate failed on main: cog (p/cog_test.ts); since d (d) run/6',
  ])
})

test('a failure its fault’s fix explains is not reported, and an unreadable log is the run’s own', async () => {
  let commits = { a: [], b: ['w/x.ts'], c: [] }
  equal(
    await told(
      [['ok', 'red', 'red']],
      {
        2: ['lens w/lens_test.ts'],
        3: ['lens w/lens_test.ts'],
      },
      commits,
      { fix: { 'ci failed: gate since b': 'c' } },
    ),
    ['gate failed on main: lens (w/lens_test.ts); since b (b) run/3'],
  )
  equal(await told([['ok', 'red']], {}, { a: [], b: [] }), [
    'gate failed on main: see its log; since b (b) run/2',
  ])
})
