// What a sync tells the local tracker and logs over its passes, on a held
// clock, each pass 30 s after the last and failing as the transport does:
// `Unavailable` where the platform tracker could not answer for now.
import { clock, equal, test, throws } from '@yaks/testing'
import { Unavailable } from './remote.ts'
import { syncing } from './sync_health.ts'

let failures: Record<string, Error> = {
  busy: new Unavailable('Remote tracker refused the read (503)'),
  late: new Unavailable('Remote tracker did not answer in time'),
  refused: Error('Remote tracker refused the read (400)'),
}
// The failure at the end of an error's causes.
let root = (error: Error): Error =>
  error.cause instanceof Error ? root(error.cause) : error

let passes = async (...said: string[]) => {
  let time = clock(), told: string[] = [], logged: string[] = []
  let sync = syncing('standing', (error) => {
    told.push(
      `${time.now() / 1000} s ${error.message} (${root(error).message})`,
    )
    return Promise.resolve()
  }, {
    every: 30_000,
    timer: (run, ms) => time.after(ms, run),
    log: (line) => logged.push(line),
  })
  for (let next of said) {
    await sync(() =>
      next == 'ok' ? Promise.resolve() : Promise.reject(failures[next])
    ).catch(() => {})
    await time.advance(30_000)
  }
  sync.close()
  return { told, logged }
}
let times = (n: number, said: string) => Array<string>(n).fill(said)

test('a sync the platform tracker could not answer for a moment tells nothing, and logs both', async () => {
  equal(await passes('busy', 'late', 'ok'), {
    told: [],
    logged: [
      'Tracker standing sync: Remote tracker refused the read (503); trying again every 30 s',
      'Tracker standing sync: Remote tracker answered again after 2 failed passes',
    ],
  })
})

test('a sync left unanswered for five minutes is told once, with its last failure', async () => {
  equal((await passes(...times(12, 'busy'))).told, [
    '300 s Tracker standing sync failed: Remote tracker has not answered for 5 minutes (Remote tracker refused the read (503))',
  ])
})

test('any other failed sync is told at once, with its failure', async () => {
  equal((await passes('busy', 'refused', 'refused')).told, [
    '30 s Tracker standing sync failed: Remote tracker refused the read (400) (Remote tracker refused the read (400))',
    '60 s Tracker standing sync failed: Remote tracker refused the read (400) (Remote tracker refused the read (400))',
  ])
})

test('a sync keeps its pass outcome', async () => {
  let sync = syncing('delivery', () => Promise.resolve(), { every: 1000 })
  equal(await sync(() => Promise.resolve(7)), 7)
  await throws(() => sync(() => Promise.reject(failures.refused)))
  sync.close()
})

test('a stopped sync tells nothing while it drains', async () => {
  let time = clock(), stop = new AbortController(), told = 0
  let sync = syncing('standing', () => {
    told++
    return Promise.resolve()
  }, {
    every: 30_000,
    timer: (run, ms) => time.after(ms, run),
    signal: stop.signal,
  })
  let end!: () => void
  let pending = sync(() =>
    new Promise<void>((_, fail) => {
      end = () => fail(failures.refused)
    })
  )
  stop.abort()
  await time.advance(300_000)
  end()
  await pending.catch(() => {})
  sync.close()
  equal(told, 0)
})
