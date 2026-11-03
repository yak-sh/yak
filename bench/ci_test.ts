// The CI watcher (ci.ts) over runs on main: which red runs it reports.
import { equal, test } from '@yaks/testing'
import { predates, type Run, type Seen, watch } from './ci.ts'

let CONCLUSION: Record<string, string> = {
  ok: 'success',
  cancelled: 'cancelled',
  skipped: 'skipped',
  red: 'failure',
}

// Each tick finishes the runs it lists, oldest first, each by its id's
// order: `ok`, `cancelled` or `red`. Says the ids reported, tick by tick.
let play = async (...ticks: string[][]) => {
  let all: Run[] = [], seen: Seen = {}, reported: number[] = []
  for (let tick of ticks) {
    for (let kind of tick) {
      let id = all.length + 1
      all.push({
        databaseId: id,
        conclusion: CONCLUSION[kind],
        displayTitle: `run ${id}`,
        headSha: 'abc',
        url: '',
      })
    }
    seen = await watch(
      ['gate'],
      seen,
      () => Promise.resolve(all.toReversed()),
      (error) => {
        reported.push(Number(error.message.match(/run (\d+)/)![1]))
        return Promise.resolve()
      },
    )
  }
  return reported
}

test('a newer success suppresses older failures in the same poll', async () => {
  equal(await play(['red', 'ok']), [])
  equal(await play(['red', 'ok', 'red']), [3])
  equal(await play(['red', 'ok', 'cancelled', 'skipped']), [])
})

test('main staying red is reported on every poll until a success', async () => {
  equal(await play(['red'], [], ['cancelled', 'skipped'], ['ok'], []), [
    1,
    1,
    1,
  ])
  equal(await play(['red', 'red'], [], ['ok', 'red'], []), [1, 2, 2, 4, 4])
})

test('a success in one workflow does not suppress another workflow failing', async () => {
  let reported: string[] = []
  let run = (id: number, conclusion: string): Run => ({
    databaseId: id,
    conclusion,
    displayTitle: `run ${id}`,
    headSha: 'abc',
    url: '',
  })
  let rows = {
    gate: [run(3, 'success'), run(1, 'failure')],
    publish: [run(2, 'failure')],
  }
  let seen = await watch(
    ['gate', 'publish'],
    {},
    (workflow) => Promise.resolve(rows[workflow as keyof typeof rows]),
    (_, workflow) => {
      reported.push(workflow)
      return Promise.resolve()
    },
  )
  equal(reported, ['publish'])
  equal(seen, { gate: 3, publish: 2 })
})

test('a listing older than the newest run seen reports nothing', async () => {
  let reported: number[] = []
  let run = (id: number, conclusion: string): Run => ({
    databaseId: id,
    conclusion,
    displayTitle: `run ${id}`,
    headSha: 'abc',
    url: '',
  })
  let report = (error: Error) => {
    reported.push(Number(error.message.match(/run (\d+)/)![1]))
    return Promise.resolve()
  }
  let seen = await watch(
    ['gate'],
    { gate: 9 },
    () => Promise.resolve([run(2, 'failure'), run(1, 'failure')]),
    report,
  )
  equal([reported, seen], [[], { gate: 9 }])
  seen = await watch(
    ['gate'],
    { gate: 9 },
    () => Promise.resolve([run(9, 'success'), run(10, 'failure')]),
    report,
  )
  equal([reported, seen], [[10], { gate: 10 }])
})

test('a failure on a commit before its resolution’s fix is dropped; one containing it reopens', async () => {
  // Main is a line of commits a → b → c; the bug was resolved with fix b.
  let line = ['a', 'b', 'c']
  let has = (commit: string, fix: string) =>
    Promise.resolve(line.indexOf(commit) >= line.indexOf(fix))
  let reported: string[] = []
  let poll = (heads: string[], fix?: string) =>
    watch(
      ['gate'],
      {},
      () =>
        Promise.resolve(heads.map((headSha, i) => ({
          databaseId: heads.length - i,
          conclusion: 'failure',
          displayTitle: headSha,
          headSha,
          url: '',
        }))),
      (_, __, run) => {
        reported.push(run.headSha)
        return Promise.resolve()
      },
      predates(() => Promise.resolve(fix), has),
    )
  await poll(['a'], 'b')
  equal(reported, [])
  await poll(['c', 'b', 'a'], 'b')
  equal(reported, ['b', 'c'])
  reported = []
  await poll(['a'])
  equal(reported, ['a'])
})
