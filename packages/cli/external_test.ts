// Coverage monitoring and readiness failures without touching the owner's
// graph, service manager or launching background workers.

import { assertEquals, assertRejects } from '@std/assert'
import { clock, test, until } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { PROCESS, type Store } from '@yaks/process'
import { coverage, monitor, ready } from './external.ts'

let processes = (rows: Bundle[]) => {
  let reads = 0
  let store: Store = {
    apply: (rows) => rows,
    get: (eids) => rows.filter((row) => eids.includes(row.entity.eid)),
    running: () => (reads++, rows.filter((row) => !row.exit)),
    services: () => [],
  }
  return { store, reads: () => reads }
}

let row = (eid: string, roles: string[], exit = false): Bundle => ({
  entity: { eid },
  [PROCESS]: { pid: 123, roles },
  ...exit ? { exit: { code: 0 } } : {},
})

test('only live unexited duty roles cover the fallback', async () => {
  let { store } = processes([
    row('web', ['graph', 'web']),
    row('pool', ['graph', 'effects']),
    row('dead', ['wake']),
    row('ended', ['process'], true),
  ])
  assertEquals(
    await coverage(
      store,
      ['effects', 'wake', 'process'],
      (eid) => Promise.resolve(eid == 'dead'),
    ).missing(),
    ['wake', 'process'],
  )
})

// Each case: what the feed hears after the first look, whether that can move
// coverage, and the roles missing at the next look.
let heard: [string, Bundle[], boolean, string[]][] = [
  ['a command beside the web', [row('cli', ['graph'])], false, ['wake']],
  ['a worker taking a duty', [row('new', ['graph', 'wake'])], true, []],
  [
    'a worker retiring',
    [{
      entity: { eid: 'pool' },
      [PROCESS]: {
        roles: ['graph'],
      },
    }],
    true,
    ['effects', 'wake'],
  ],
  ['a worker exiting', [{ entity: { eid: 'pool' }, exit: { code: 0 } }], true, [
    'effects',
    'wake',
  ]],
  ['a worker deleted', [{ entity: { eid: 'pool' }, $delete: true }], true, [
    'effects',
    'wake',
  ]],
  [
    'a patch that leaves roles alone',
    [{
      entity: { eid: 'pool' },
      [PROCESS]: {
        pid: 9,
      },
    }],
    false,
    ['wake'],
  ],
]
for (let [name, rows, moves, left] of heard) {
  test(`coverage follows the feed: ${name}, reading the store once`, async () => {
    let p = processes([row('pool', ['graph', 'effects'])])
    let covered = coverage(
      p.store,
      ['effects', 'wake'],
      () => Promise.resolve(false),
    )
    assertEquals(await covered.missing(), ['wake'])
    assertEquals(covered.hear(rows), moves)
    assertEquals(await covered.missing(), left)
    assertEquals(p.reads(), 1)
  })
}

test('a known coverer whose pid is gone stops covering without a feed row', async () => {
  let p = processes([row('pool', ['effects'])])
  let dead = false
  let covered = coverage(p.store, ['effects'], () => Promise.resolve(dead))
  assertEquals(await covered.missing(), [])
  dead = true
  assertEquals(await covered.missing(), ['effects'])
  assertEquals(p.reads(), 1)
})

test('a store with no feed is read whole at each look', async () => {
  let rows: Bundle[] = []
  let p = processes(rows)
  let covered = coverage(
    p.store,
    ['effects'],
    () => Promise.resolve(false),
    false,
  )
  assertEquals(await covered.missing(), ['effects'])
  rows.push(row('pool', ['effects']))
  assertEquals(await covered.missing(), [])
  assertEquals(p.reads(), 2)
})

let child = (status = new Promise<{ code: number }>(() => {})) => {
  let unrefs = 0
  let kills = 0
  return {
    process: {
      pid: 123,
      status,
      unref: () => unrefs++,
      kill: (_signal: 'SIGTERM') => kills++,
    },
    counts: () => ({ unrefs, kills }),
  }
}

test('ready worker is detached and never stopped', async () => {
  let run = child()
  let reads = 0
  await ready(
    run.process,
    () => Promise.resolve(++reads == 1 ? '999\n' : '123\n'),
    100,
    () => Promise.resolve(),
    () => 0,
  )
  assertEquals(reads, 2)
  assertEquals(run.counts(), { unrefs: 1, kills: 0 })
})

test('worker exit is an explicit readiness error, not a successful launch', async () => {
  let run = child(Promise.resolve({ code: 7 }))
  await assertRejects(
    () => ready(run.process, () => Promise.resolve('123\n')),
    Error,
    'exited before readiness (code 7)',
  )
  assertEquals(run.counts(), { unrefs: 1, kills: 0 })
})

test('bounded readiness timeout stops only this failed launch', async () => {
  let run = child()
  let time = 0
  await assertRejects(
    () =>
      ready(
        run.process,
        () => Promise.resolve(undefined),
        100,
        () => {
          time += 50
          return Promise.resolve()
        },
        () => time,
      ),
    Error,
    'did not become ready within 100ms',
  )
  assertEquals(run.counts(), { unrefs: 1, kills: 1 })
})

let deferred = <T>() => {
  let resolve!: (value: T) => void
  let promise = new Promise<T>((done) => resolve = done)
  return { promise, resolve }
}

let fixture = (initial: string[] = []) => {
  let time = clock()
  let needed = initial
  let inspect = () => Promise.resolve(needed)
  let launch = (_roles: string[], _signal: AbortSignal) => Promise.resolve()
  let notify = () => {}
  let unsubscribed = 0
  let events: {
    kind: string
    roles?: string[]
    role?: string
    error?: unknown
  }[] = []
  let control = new AbortController()
  let coverage = monitor({
    uncovered: () => inspect(),
    start: (roles, signal) => {
      events.push({ kind: 'start', roles })
      return launch(roles, signal)
    },
    report: (error, role) => {
      events.push({ kind: 'report', role, error })
    },
    subscribe: (changed) => {
      notify = changed
      return () => {
        unsubscribed++
      }
    },
    signal: control.signal,
    interval: 100,
    now: time.now,
    after: time.after,
  })
  return {
    coverage,
    time,
    control,
    events,
    notify: () => notify(),
    needed: (roles: string[]) => {
      needed = roles
    },
    inspect: (next: typeof inspect) => {
      inspect = next
    },
    launch: (next: typeof launch) => {
      launch = next
    },
    unsubscribed: () => unsubscribed,
  }
}

test('coverage reports each absent duty before a launch can succeed', async () => {
  let f = fixture(['effects', 'wake'])
  let launched = deferred<void>()
  let starting = deferred<void>()
  f.launch(() => {
    starting.resolve()
    return launched.promise
  })
  // Inspect/report do not wait for worker readiness.
  await starting.promise
  assertEquals(f.events.map((e) => [e.kind, e.role ?? e.roles]), [
    ['report', 'effects'],
    ['report', 'wake'],
    ['start', ['effects', 'wake']],
  ])
  launched.resolve()
  await f.coverage.checked
  await f.coverage.close()
})

// Prepare a real private monitor before the test timer; only immutable
// observations cross into the assertions, never a live fixture or clock.
let dutyLoss = await (async () => {
  let f = fixture()
  try {
    await f.coverage.checked
    let initially = f.events.length
    f.needed(['wake'])
    f.notify()
    await until(() => f.events.some((e) => e.kind == 'start'))
    let first = Object.freeze(
      f.events.filter((e) => e.kind == 'report').map((e) => e.role),
    )
    f.needed([])
    await f.time.advance(100)
    f.needed(['wake'])
    await f.time.advance(100)
    return Object.freeze({
      initially,
      first,
      recovered: Object.freeze(
        f.events.filter((e) => e.kind == 'report').map((e) => e.role),
      ),
      starts: f.events.filter((e) => e.kind == 'start').length,
    })
  } finally {
    await f.coverage.close()
  }
})()

test('covered duty loss notifies immediately and is reported again after recovery', () => {
  assertEquals(dutyLoss.initially, 0)
  assertEquals(dutyLoss.first, ['wake'])
  assertEquals(dutyLoss.recovered, ['wake', 'wake'])
  assertEquals(dutyLoss.starts, 2)
})

test('failed recovery retries on a bounded poll, without flooding missing reports', async () => {
  let f = fixture(['wake'])
  f.launch(() => Promise.reject(new Error('cannot spawn')))
  try {
    await f.coverage.checked
    assertEquals(f.events.map((e) => e.kind), ['report', 'start', 'report'])
    for (let i = 0; i < 20; i++) f.notify()
    await f.time.advance(99)
    assertEquals(f.events.filter((e) => e.kind == 'start').length, 1)
    await f.time.advance(100)
    // The poll is relative to the last inspection, but always bounded.
    assertEquals(f.events.filter((e) => e.kind == 'start').length, 2)
    assertEquals(
      f.events.filter((e) =>
        e.kind == 'report' && String(e.error).includes('No live process')
      ).length,
      1,
    )
  } finally {
    await f.coverage.close()
  }
})

let notifications = await (async () => {
  let f = fixture()
  await f.coverage.checked
  let inspected = deferred<string[]>()
  let launched = deferred<void>()
  let inspecting = 0
  let peak = 0
  f.inspect(async () => {
    peak = Math.max(peak, ++inspecting)
    let roles = await inspected.promise
    inspecting--
    return roles
  })
  f.launch(() => launched.promise)
  let during!: Readonly<{ peak: number; starts: number }>
  try {
    f.notify()
    await Promise.resolve()
    for (let i = 0; i < 20; i++) f.notify()
    inspected.resolve(['wake'])
    await until(() => f.events.some((e) => e.kind == 'start'))
    for (let i = 0; i < 20; i++) f.notify()
    during = Object.freeze({
      peak,
      starts: f.events.filter((e) => e.kind == 'start').length,
    })
    launched.resolve()
  } finally {
    launched.resolve()
    await f.coverage.close()
  }
  return Object.freeze({ during, finalPeak: peak })
})()

test('process notifications during inspection/launch coalesce without overlap', () => {
  assertEquals(notifications.during.peak, 1)
  assertEquals(notifications.during.starts, 1)
  assertEquals(notifications.finalPeak, 1)
})

test('dead pid polling detects loss without a process notification', async () => {
  let f = fixture()
  try {
    await f.coverage.checked
    f.needed(['process'])
    await f.time.advance(100)
    assertEquals(f.events.map((e) => e.kind), ['report', 'start'])
  } finally {
    await f.coverage.close()
  }
})

test('web shutdown cancels pending launch, unsubscribes and stops retrying', async () => {
  let f = fixture(['wake'])
  let started = deferred<void>()
  let aborted = false
  f.launch((_roles, signal) =>
    new Promise((_resolve, reject) => {
      started.resolve()
      signal.addEventListener('abort', () => {
        aborted = true
        reject(new Error('cancelled'))
      }, { once: true })
    })
  )
  await started.promise
  f.control.abort()
  await f.coverage.close()
  assertEquals(aborted, true)
  assertEquals(f.events.map((e) => e.kind), ['report', 'start'])
  f.notify()
  await f.time.advance(1000)
  assertEquals(f.events.map((e) => e.kind), ['report', 'start'])
  assertEquals(f.unsubscribed(), 1)
})

test('readiness cancellation stops only an unfinished launch', async () => {
  let run = child()
  let stop = new AbortController()
  let reading = deferred<void>()
  let waiting = ready(
    run.process,
    () => {
      reading.resolve()
      return new Promise(() => {})
    },
    undefined,
    undefined,
    undefined,
    stop.signal,
  )
  await reading.promise
  stop.abort(new Error('web closed'))
  await assertRejects(() => waiting, Error, 'web closed')
  assertEquals(run.counts(), { unrefs: 1, kills: 1 })
})

test('successful readiness survives subsequent web cancellation', async () => {
  let run = child()
  let stop = new AbortController()
  await ready(
    run.process,
    () => Promise.resolve('123'),
    undefined,
    undefined,
    undefined,
    stop.signal,
  )
  stop.abort()
  assertEquals(run.counts(), { unrefs: 1, kills: 0 })
})

test('tracker failure does not prevent launch or bounded retries', async () => {
  let time = clock()
  let starts = 0
  let coverage = monitor({
    uncovered: () => Promise.resolve(['wake']),
    report: () => Promise.reject(new Error('tracker offline')),
    start: () => {
      starts++
      return Promise.reject(new Error('spawn failed'))
    },
    interval: 100,
    after: time.after,
    now: time.now,
  })
  try {
    await coverage.checked
    assertEquals(starts, 1)
    await time.advance(100)
    assertEquals(starts, 2)
  } finally {
    await coverage.close()
  }
})

test('pending tracker delivery never blocks duty recovery or monitor close', async () => {
  let starts = 0
  let coverage = monitor({
    uncovered: () => Promise.resolve(['effects']),
    report: () => new Promise(() => {}),
    start: () => {
      starts++
      return Promise.resolve()
    },
  })
  await coverage.checked
  assertEquals(starts, 1)
  await coverage.close()
})

test('an already closed web neither observes nor launches', async () => {
  let stop = new AbortController()
  stop.abort()
  let checked = 0
  let coverage = monitor({
    signal: stop.signal,
    uncovered: () => {
      checked++
      return Promise.resolve(['effects'])
    },
    subscribe: () => {
      throw new Error('must not subscribe')
    },
    report: () => {
      throw new Error('must not report')
    },
    start: () => {
      throw new Error('must not launch')
    },
  })
  await coverage.checked
  await coverage.close()
  assertEquals(checked, 0)
})

test('coverage probes only requested duties and stops once all are covered', async () => {
  let checked: string[] = []
  let { store } = processes([
    row('web', ['graph', 'web']),
    row('agent', ['graph']),
    row('dead', ['effects', 'wake']),
    row('duties', ['effects', 'wake']),
    row('redundant', ['effects', 'wake']),
  ])
  let over = (eid: string) => {
    checked.push(eid)
    return Promise.resolve(eid == 'dead')
  }
  assertEquals(
    await coverage(store, ['effects', 'wake'], over).missing(),
    [],
  )
  assertEquals(checked, ['dead', 'duties'])
  checked.length = 0
  assertEquals(await coverage(store, [], over).missing(), [])
  assertEquals(checked, [])
})
