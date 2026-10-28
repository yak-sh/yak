// The CI watcher (ci.ts) over runs on main: which red runs it reports.
import { equal, test } from '@yaks/testing'
import { type Run, type State, type Verdict, watch } from './ci.ts'

// Each tick finishes the runs it lists, oldest first, each by its id's
// order: `ok`, `cancelled`, `broken`, or `over` and what it was over. Says
// the ids reported, tick by tick.
let play = async (...ticks: string[][]) => {
  let all: Run[] = [], verdicts = new Map<number, Verdict>()
  let state: State = { seen: {}, held: {} }, reported: number[] = []
  for (let tick of ticks) {
    for (let said of tick) {
      let [kind, ...over] = said.split(' '), id = all.length + 1
      all.push({
        databaseId: id,
        conclusion: kind == 'ok'
          ? 'success'
          : kind == 'cancelled'
          ? kind
          : 'failure',
        displayTitle: `run ${id}`,
        headSha: 'abc',
        url: '',
      })
      verdicts.set(
        id,
        kind == 'over' ? { broken: false, over } : { broken: true },
      )
    }
    state = await watch(
      ['gate'],
      state,
      () => Promise.resolve(all.toReversed()),
      (_, run) => Promise.resolve(verdicts.get(run.databaseId)!),
      (error) => {
        reported.push(Number(error.message.match(/run (\d+)/)![1]))
        return Promise.resolve()
      },
      () => {},
    )
  }
  return reported
}

test('a run over a time once, then passing, is never reported', async () => {
  equal(await play(['over a', 'ok']), [])
  equal(await play(['over a'], ['ok']), [])
})

test('a run over the same time as the run before it is reported', async () => {
  equal(await play(['over a b', 'over b']), [2])
  equal(await play(['over a'], ['cancelled'], ['over a']), [3])
})

test('runs over different times are each a blip', async () => {
  equal(await play(['over a', 'over b', 'ok']), [])
})

test('a broken run is reported at once, held or not', async () => {
  equal(await play(['broken']), [1])
  equal(await play(['over a', 'broken', 'ok']), [2])
})
