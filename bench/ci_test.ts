// The CI watcher (ci.ts) over runs on main: which red runs it reports.
import { equal, test } from '@yaks/testing'
import { type Run, type Seen, watch } from './ci.ts'

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
