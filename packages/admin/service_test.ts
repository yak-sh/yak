// The deploy catch-up through its doors: a head Builds never deployed gets one
// build and two reports, and a head that is live, holds the same Worker
// source, is still building, is being rebuilt after its build failed or was
// rolled back past gets none. Each deploy a look shows is timed once, and
// slower deploys, or a home page that does not answer, are reported.
import { equal, match, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { Interrupted } from '@yaks/tools/errors'
import {
  BOUND,
  type Build,
  firstShown,
  LATE,
  PENDING,
  SLOW,
  WINDOW,
} from './catchup.ts'
import { adminDoc } from './vocab.ts'
import { type Doors, pass, service } from './service.ts'

// The words the catch-up writes, and the entity they sit on.
let pick = (doc: VocabDoc, ...names: string[]): VocabDoc => ({
  $defs: Object.fromEntries(names.map((name) => [name, doc.$defs![name]])),
})
let vocab = loadVocab([
  pick(kernelDoc, 'entity', 'failed'),
  pick(adminDoc, 'rebuilt', 'deployed'),
], [kernelKeywords])
let MIN = 60_000

// Today's miss: 739f56b25 landed at 12:42:23Z while e56889ea5 was live.
let HEAD = '739f56b25cae820c8541a8b4a1ade2f7a6c7e9be'
let LIVE = 'e56889ea55133713b3034a4096d9e857eab5eefe'
let landed = Date.parse('2026-10-13T12:42:23Z')

let fixture = (
  live: { sha?: string; at?: number; rollback?: boolean } = {},
  same = false,
) => {
  let at = { now: landed }
  let looked = 0
  let started = 0
  let build: Build = {}
  let reports: [Error, Record<string, unknown>][] = []
  let doors: Doors = {
    main: () => Promise.resolve({ sha: HEAD, at: landed }),
    live: () => {
      looked++
      return Promise.resolve({
        sha: LIVE,
        at: Date.parse('2026-10-13T12:39:47Z'),
        rollback: false,
        debuts: [],
        ...live,
      })
    },
    pushed: () => Promise.resolve(undefined),
    answers: () => Promise.resolve(undefined),
    same: () => Promise.resolve(same),
    build: () => Promise.resolve(build),
    start: () => {
      started++
      return Promise.resolve('build aa194fb5 queued')
    },
    now: () => at.now,
    wait: () => Promise.resolve(),
  }
  // The marks are stamped on the same clock the doors read.
  let g = graph({
    vocab,
    storage: ram(vocab),
    clock: () => new Date(at.now).toISOString(),
  })
  let report = (error: unknown, context?: Record<string, unknown>) => {
    reports.push([error as Error, context ?? {}])
  }
  let look = () => pass(g, doors, report)
  return {
    g,
    doors,
    at,
    look,
    reports,
    get looked() {
      return looked
    },
    get started() {
      return started
    },
    set build(now: Build) {
      build = now
    },
  }
}

let beforeBound = fixture()
beforeBound.at.now = landed + LATE - MIN
let atBound = fixture()
atBound.at.now = landed + LATE
test('before it is late, a head does not look for a live build', async () => {
  equal((await beforeBound.look()).step, 'wait')
  equal(beforeBound.looked, 0)
})

test('a late head no build deployed gets one start', async () => {
  let f = atBound
  equal((await f.look()).step, 'rebuild')
  let [row] = await f.g.get([HEAD])
  equal((row.rebuilt as { said: string }).said, 'build aa194fb5 queued')
  let [error, context] = f.reports[0]
  match(error.message, /739f56b2 is not live 3 min .* build aa194fb5 queued/)
  equal(context.commit, HEAD)
  equal(context.tags, {
    worker: 'yak',
    live: LIVE,
    builds: 'build aa194fb5 queued',
  })
  equal(f.started, 1)
})

test('a bound after its start, the catch-up gives up on it once', async () => {
  let f = fixture()
  f.at.now = landed + LATE
  await f.g.apply([{
    entity: { eid: HEAD },
    rebuilt: { said: 'build aa194fb5 queued' },
  }])
  f.at.now += BOUND - MIN
  equal((await f.look()).step, 'wait')
  f.at.now += 2 * MIN
  equal((await f.look()).step, 'fail')
  let [row] = await f.g.get([HEAD])
  ok(row.failed)
  match(f.reports[0][0].message, /still not live .*build aa194fb5 queued/)

  f.at.now += 9 * BOUND
  equal((await f.look()).step, 'done')
  equal([f.started, f.reports.length], [0, 1])
})

test('a pending build answers the start and is not reported', async () => {
  let f = fixture()
  f.doors.start = () => Promise.resolve(PENDING)
  f.at.now = landed + LATE
  equal((await f.look()).step, 'rebuild')
  equal(f.reports.length, 0)
  f.at.now += BOUND - MIN
  equal((await f.look()).step, 'wait')
})

test('a late head whose build is running waits for it, unreported', async () => {
  let f = fixture()
  f.build = { building: true }
  f.at.now = landed + LATE
  equal((await f.look()).step, 'wait')
  equal([f.started, f.reports.length], [0, 0])
  f.build = {}
  f.at.now += MIN
  equal((await f.look()).step, 'rebuild')
  equal(f.started, 1)
})

// fcabed20's build failed at 12:59:40Z, four minutes after its push; the
// kernel's rebuild went live 77 s later.
test('a head whose build failed waits a bound for its rebuild, then gets one', async () => {
  let f = fixture()
  f.build = { broke: landed + LATE - 5_000 }
  f.at.now = landed + LATE
  equal((await f.look()).step, 'wait')
  f.at.now += BOUND - 2 * MIN
  equal((await f.look()).step, 'wait')
  equal([f.started, f.reports.length], [0, 0])
  f.at.now += 2 * MIN
  equal((await f.look()).step, 'rebuild')
  match(
    f.reports[0][0].message,
    /739f56b2 is not live 15 min after its Workers Build failed; .*No build of main deployed it since.* build aa194fb5 queued/,
  )
  equal(f.started, 1)
})

test('a live head, the same source or a newer rollback starts nothing', async () => {
  for (
    let [f, want] of [
      [fixture({ sha: HEAD }), 'live'],
      [fixture({}, true), 'live'],
      [fixture({ at: landed + MIN, rollback: true }), 'held'],
    ] as const
  ) {
    f.at.now = landed + LATE
    equal((await f.look()).step, want)
    equal([f.started, f.reports.length], [0, 0])
  }
})

let unmarked = fixture()
unmarked.at.now = landed + LATE
await unmarked.look()
await unmarked.g.apply([{ entity: { eid: HEAD }, rebuilt: null }])
unmarked.at.now += MIN

test('removing the marks asks for another start', async () => {
  let f = unmarked
  equal((await f.look()).step, 'rebuild')
  equal(f.started, 2)
})

// A live head whose look shows a deploy per `took` (seconds from push to live,
// oldest first, an hour apart, the head's last) and whose home page answers
// `home`. Says what the look reported, and how often it asked the home page.
let deploys = (took: number[], home?: string) => {
  let f = fixture({ sha: HEAD })
  let shas = took.map((_, i) => i == took.length - 1 ? HEAD : `${i}`.repeat(40))
  let push = (i: number) => landed - (took.length - 1 - i) * 60 * MIN
  let debuts = took.map((s, i) => ({ sha: shas[i], at: push(i) + s * 1000 }))
  f.doors.live = () =>
    Promise.resolve({ sha: HEAD, at: landed, rollback: false, debuts })
  f.doors.pushed = (sha) => Promise.resolve(push(shas.indexOf(sha)))
  let asked = 0
  f.doors.answers = () => (asked++, Promise.resolve(home))
  f.at.now = landed + LATE
  let look = async () => {
    await f.look()
    return {
      faults: f.reports.map(([e, c]) => `${c.fault}: ${e.message}`),
      asked,
    }
  }
  return { ...f, look }
}

test('each deploy a look shows is timed once, and the head asks yaks.app once', async () => {
  let f = deploys([90, 60])
  equal(await f.look(), { faults: [], asked: 1 })
  equal(await f.look(), { faults: [], asked: 1 })
  let [row] = await f.g.get([HEAD], ['deployed'])
  equal(row.deployed, {
    pushed: '2026-10-13T12:42:23.000Z',
    live: '2026-10-13T12:43:23.000Z',
  })
})

test('deploys that got slower are a bug of their own', async () => {
  let half = WINDOW / 2, slower = 3 * SLOW / 1000
  let f = deploys([...Array(half).fill(60), ...Array(half).fill(slower)])
  match(
    (await f.look()).faults.join('\n'),
    /^deploy slow:yak: main's deploys got slower: .* Newest first: 739f56b2 /,
  )
})

test('a home page that does not answer once the head is live is a bug of its own', async () => {
  let f = deploys([60], 'HTTP 503')
  equal((await f.look()).faults, [
    "deploy down:yak: yaks.app's home page did not answer 200 once main's head 739f56b2 went live: HTTP 503",
  ])
})

test('the service reads a settled head no more, and a failing look once', async () => {
  let f = fixture({ sha: HEAD })
  f.at.now = landed + LATE
  let passes = 0
  let stop = new AbortController()
  let reports: unknown[] = []
  let broken = false
  let main = f.doors.main
  f.doors.main = () => {
    if (++passes == 6) stop.abort()
    if (broken) return Promise.reject(new Error('origin is unreachable'))
    if (passes == 3) broken = true
    return main()
  }
  await service(
    { graph: f.g, report: (error) => void reports.push(error) },
    { every: 0 },
    stop.signal,
    f.doors,
  )
  equal(f.looked, 1)
  equal(reports.length, 1)
  match(String(reports[0]), /origin is unreachable/)
})

test('a look cut off by shutdown is not reported', async () => {
  let f = fixture({ sha: HEAD })
  let stop = new AbortController()
  let reports: unknown[] = []
  let main = f.doors.main
  let passes = 0
  // The child's signal can reach it before the host's own abort does.
  f.doors.main = () => {
    if (++passes == 1) {
      return Promise.reject(new Interrupted('cut off', 'signal'))
    }
    stop.abort()
    return main()
  }
  await service(
    { graph: f.g, report: (error) => void reports.push(error) },
    { every: 0 },
    stop.signal,
    f.doors,
  )
  equal([passes, reports.length], [2, 0])
})

test("a head's clock starts when it is first shown and holds until the head moves", () => {
  let t = 0
  let shown = firstShown(() => t)
  equal(shown('a'), { sha: 'a', at: 0 })
  t = 60_000
  equal(shown('a'), { sha: 'a', at: 0 })
  equal(shown('b'), { sha: 'b', at: 60_000 })
})
