// The CI watcher (ci.ts) over runs on main: which red runs it reports.
import { equal, test } from '@yaks/testing'
import { type Run, type Seen, watch } from './ci.ts'

let CONCLUSION: Record<string, string> = {
  ok: 'success',
  cancelled: 'cancelled',
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

test('each red run is reported once, when it is first seen', async () => {
  equal(await play(['red', 'ok'], ['red'], ['cancelled', 'ok']), [1, 3])
  equal(await play(['red', 'red'], []), [1, 2])
})
