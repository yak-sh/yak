// Handover ordering and failures, with no systemd or filesystem operations.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import {
  PATIENCE,
  queueRestart,
  restart,
  type RestartOptions,
} from './restart.ts'

// A box running two primary workers and a web, with no tracker; `extra`
// adds active units to what systemd lists.
let fixture = (extra: string[] = []) => {
  let calls: string[][] = []
  let paths: string[] = []
  let events: string[] = []
  let elapsed = 0
  let options: RestartOptions = {
    runtimeDir: '/runtime/',
    lock: () =>
      Promise.resolve({
        read: () => Promise.resolve(''),
        write: () => Promise.resolve(),
        close: () => {},
      }),
    systemctl: '/fake/systemctl',
    run: (command, args) => {
      assertEquals(command, '/fake/systemctl')
      calls.push(args.slice(1))
      events.push(args.includes('list-units') ? 'list' : args[2])
      return Promise.resolve({
        code: 0,
        stdout: args.includes('list-units')
          ? [
            'yak-work@old',
            'yak-work@older',
            'other',
            'yak-web@old',
            ...extra,
          ]
            .map((u) => `${u}.service loaded active running ${u}\n`).join('')
          : '',
        stderr: '',
      })
    },
    ready: (path) => {
      paths.push(path)
      events.push('ready')
      return Promise.resolve(true)
    },
    stale: () => Promise.resolve('a.ts differs'),
    now: () => elapsed,
    sleep: (milliseconds) => {
      elapsed += milliseconds
      return Promise.resolve()
    },
  }
  return { calls, paths, events, options, elapsed: () => elapsed }
}

type Fixture = ReturnType<typeof fixture>

// The units started, in order.
let started = (f: Fixture) =>
  f.calls.filter((c) => c[1] == 'start').flatMap((c) => c.slice(2))
// The units stopped, call by call.
let stopped = (f: Fixture) =>
  f.calls.filter((c) => c[1] == 'stop').map((c) => c.slice(2))

let fail = (f: Fixture, action: string, unit?: string) => {
  let run = f.options.run!
  f.options.run = async (command, args) => {
    let result = await run(command, args)
    return args.includes(action) &&
        (unit === undefined || args.some((a) => a.startsWith(unit)))
      ? { code: 1, stdout: '', stderr: `failed ${action}` }
      : result
  }
}

test('restart starts every replacement at once and retires the old units only after all are ready', async () => {
  let f = fixture()
  f.options.ready = (path) => {
    f.paths.push(path)
    f.events.push('ready')
    return Promise.resolve(f.paths.length != 1)
  }
  let said = await restart(f.options)
  let [work, web] = started(f)
  assertMatch(work, /^yak-work@[a-f0-9-]+\.service$/)
  assertMatch(web, /^yak-web@[a-f0-9-]+\.service$/)
  assertEquals(f.calls[0], [
    'list-units',
    '--state=active',
    '--plain',
    '--no-legend',
    '--no-pager',
    'yak-work@*.service',
    'yak-tracker@*.service',
    'yak-web@*.service',
    'yak-tracker-web@*.service',
  ])
  assertEquals(f.events, ['list', 'start', 'ready', 'ready', 'ready', 'stop'])
  assertEquals(stopped(f), [[
    'yak-work@old.service',
    'yak-work@older.service',
    'yak-web@old.service',
  ]])
  let file = (unit: string) =>
    `/runtime/${unit.replace('@', '-').replace('.service', '.ready')}`
  assertEquals(f.paths, [file(work), file(web), file(work)])
  assertEquals(
    said,
    `${work} ready in 0.1s; stopping yak-work@old.service (a.ts differs), yak-work@older.service (a.ts differs)\n` +
      `${web} ready in 0.0s; stopping yak-web@old.service (a.ts differs)`,
  )
})

test('restart keeps a role whose every unit runs the code a replacement would', async () => {
  let f = fixture()
  let differs: Record<string, string | undefined> = {
    'yak-work@old.service': undefined,
    'yak-work@older.service': 'packages/effects/pool.ts differs',
  }
  f.options.stale = (unit) => Promise.resolve(differs[unit])
  let said = await restart(f.options)
  let [work, ...rest] = started(f)
  assertMatch(work, /^yak-work@/)
  assertEquals(rest, [])
  assertEquals(stopped(f), [['yak-work@old.service', 'yak-work@older.service']])
  assertEquals(
    said,
    `${work} ready in 0.0s; stopping yak-work@old.service, yak-work@older.service (packages/effects/pool.ts differs)\n` +
      'yak-web@old.service runs this code; kept',
  )
  f = fixture()
  f.options.stale = () => Promise.resolve(undefined)
  assertEquals(
    await restart(f.options),
    [
      'yak-work@old.service runs this code; kept',
      'yak-work@older.service runs this code; kept',
      'yak-web@old.service runs this code; kept',
    ].join('\n'),
  )
  assertEquals(f.events, ['list'])
})

test('restart replaces a role it is asked to even when it runs this code', async () => {
  let f = fixture()
  f.options.stale = () => Promise.resolve(undefined)
  f.options.replace = ['yak-work']
  let said = await restart(f.options)
  let [work, ...rest] = started(f)
  assertMatch(work, /^yak-work@/)
  assertEquals(rest, [])
  assertEquals(stopped(f), [['yak-work@old.service', 'yak-work@older.service']])
  assertEquals(
    said,
    `${work} ready in 0.0s; stopping yak-work@old.service (asked to replace), yak-work@older.service (asked to replace)\n` +
      'yak-web@old.service runs this code; kept',
  )
  f = fixture()
  f.options.replace = ['yak-wrok']
  await assertRejects(() => restart(f.options), Error, 'No role yak-wrok')
  assertEquals(f.calls, [])
})

test('restart replaces a unit whose code it cannot judge', async () => {
  let f = fixture()
  f.options.stale = (unit) =>
    unit.startsWith('yak-web')
      ? Promise.reject(new Error('unreadable'))
      : Promise.resolve(undefined)
  let said = await restart(f.options)
  let [web] = started(f)
  assertMatch(web, /^yak-web@/)
  assertMatch(said, /stopping yak-web@old\.service \(Error: unreadable\)/)
})

test('restart starts unique replacements and stops nothing on a bare box', async () => {
  let f = fixture()
  f.options.run = (_command, args) => {
    f.calls.push(args.slice(1))
    return Promise.resolve({ code: 0, stdout: '', stderr: '' })
  }
  let first = await restart(f.options)
  let second = await restart(f.options)
  assert(first != second)
  assertEquals(stopped(f), [])
  assertEquals(started(f).map((u) => u.split('@')[0]), [
    'yak-work',
    'yak-web',
    'yak-work',
    'yak-web',
  ])
  assert(!first.includes('stopping'), first)
})

// Complete the fake-clock polling before timing the deadline contract.
// Promise turns measure the runner's scheduling, not elapsed wall time.
let timeout = fixture()
timeout.options.ready = () => Promise.resolve(false)
let timeoutError = await assertRejects(() => restart(timeout.options), Error)

test('restart bounds the supervised handover and stops only its replacement', () => {
  assert(timeoutError.message.includes(`Timed out after ${PATIENCE}ms`))
  assertEquals(timeout.elapsed(), PATIENCE)
  assertEquals(stopped(timeout), [started(timeout)])
})

test('restart rejects readiness that arrives after its deadline', async () => {
  let f = fixture()
  let sleep = f.options.sleep!
  f.options.ready = async () => {
    await sleep(PATIENCE + 1)
    return true
  }
  await assertRejects(() => restart(f.options), Error, 'Timed out')
  assertEquals(stopped(f), [started(f)])
})

test('restart leaves every unit untouched when listing fails', async () => {
  let f = fixture()
  fail(f, 'list-units')
  await assertRejects(() => restart(f.options), Error, 'failed list-units')
  assertEquals(f.calls.length, 1)
})

test('restart cleans up a failed start or readiness and stops nothing else', async () => {
  for (
    let broken of [
      (f: Fixture) => fail(f, 'start'),
      (f: Fixture) =>
        f.options.ready = () => Promise.reject(new Error('readiness denied')),
    ]
  ) {
    let f = fixture()
    broken(f)
    await assertRejects(() => restart(f.options))
    assertEquals(stopped(f), [started(f)])
  }
})

test('restart keeps the ready replacements when stopping the old fails', async () => {
  let f = fixture()
  fail(f, 'stop', 'yak-work@old')
  await assertRejects(() => restart(f.options), Error, 'failed stop')
  assertEquals(stopped(f).length, 1)
  assert(!stopped(f)[0].some((u) => started(f).includes(u)))
})

test('restart reports both the handover and the cleanup failing', async () => {
  let f = fixture()
  fail(f, 'start')
  fail(f, 'stop')
  let error = await assertRejects(() => restart(f.options), AggregateError)
  assertMatch(String(error.errors[0]), /failed start/)
  assertMatch(String(error.errors[1]), /failed stop/)
})

test('restart rolls optional roles only where they run', async () => {
  let bare = fixture()
  await restart(bare.options)
  assert(!started(bare).some((u) => u.includes('tracker')))
  let f = fixture(['yak-tracker@old', 'yak-tracker-web@old'])
  await restart(f.options)
  assertEquals(started(f).map((u) => u.split('@')[0]), [
    'yak-work',
    'yak-tracker',
    'yak-web',
    'yak-tracker-web',
  ])
  assertEquals(stopped(f)[0].filter((u) => u.includes('tracker')), [
    'yak-tracker@old.service',
    'yak-tracker-web@old.service',
  ])
})

let unready = fixture(['yak-tracker@old'])
unready.options.ready = (path) => Promise.resolve(!path.includes('yak-web-'))
let unreadyError = await assertRejects(() => restart(unready.options), Error)

test('a replacement that never readies leaves the old units and the ready replacements running', () => {
  assertMatch(unreadyError.message, /Timed out/)
  let [work, tracker, web] = started(unready)
  assertEquals(stopped(unready), [[web]])
  assert(work && tracker)
})

test('every role shares the same readiness deadline', async () => {
  let f = fixture()
  let sleep = f.options.sleep!
  f.options.ready = async () => {
    await sleep(PATIENCE / 2)
    return true
  }
  await assertRejects(() => restart(f.options), Error, 'Timed out')
  assertEquals(f.elapsed(), PATIENCE)
  assertEquals(stopped(f), [[started(f)[1]]])
})

let evidence = fixture()
let evidenceRun = evidence.options.run!
evidence.options.run = async (command, args) => {
  let result = await evidenceRun(command, args)
  return args.includes('show')
    ? {
      ...result,
      stdout: 'ActiveState=active\nSubState=running\nMainPID=42\nJob=\n',
    }
    : result
}
evidence.options.ready = () => Promise.resolve(false)
let evidenceError = await assertRejects(() => restart(evidence.options), Error)

test('restart captures startup evidence before timeout cleanup can unload it', () => {
  assertMatch(evidenceError.message, /MainPID=42/)
  assertMatch(evidenceError.message, /ActiveState=active/)
  let show = evidence.calls.findIndex((c) => c[0] == 'show')
  let stop = evidence.calls.findIndex((c) => c.includes('stop'))
  assert(show > 0 && show < stop)
})

test('restart rolls configured mail even on its first installation', async () => {
  let f = fixture(['yak-mail@old'])
  f.options.processes = [
    { unit: 'yak-work' },
    { unit: 'yak-mail' },
    { unit: 'yak-web' },
  ]
  await restart(f.options)
  assertEquals(started(f).map((unit) => unit.split('@')[0]), [
    'yak-work',
    'yak-mail',
    'yak-web',
  ])
  assertEquals(stopped(f), [[
    'yak-work@old.service',
    'yak-work@older.service',
    'yak-mail@old.service',
    'yak-web@old.service',
  ]])
  let first = fixture()
  first.options.processes = [{ unit: 'yak-mail' }]
  await restart(first.options)
  assertEquals(started(first).length, 1)
})

// Exercise the OS lock too: three calls start before the first snapshot
// completes.
// Finish filesystem work outside the timed assertion.
let concurrent = await Deno.makeTempDir({ prefix: 'yak-restart-' })
let active = new Set(['probe@old.service'])
let snapshots: string[][] = []
let starts: string[] = []
let options: RestartOptions = {
  runtimeDir: concurrent,
  roles: [{ unit: 'probe', old: ['probe@*.service'] }],
  ready: () => Promise.resolve(true),
  run: (_command, args) => {
    if (args.includes('list-units')) snapshots.push([...active])
    if (args.includes('start')) {
      for (let unit of args.slice(3)) active.add(unit)
      starts.push(...args.slice(3))
    }
    if (args.includes('stop')) {
      for (let unit of args.slice(3)) active.delete(unit)
    }
    return Promise.resolve({
      code: 0,
      stdout: [...active].join('\n'),
      stderr: '',
    })
  },
}
let tick = 0
options.clock = () => ++tick
let listed = Promise.withResolvers<void>()
let proceed = Promise.withResolvers<void>()
let run = options.run!
options.run = async (command, args) => {
  listed.resolve()
  await proceed.promise
  return run(command, args)
}
let first = restart(options)
await listed.promise
let waiting = [restart(options), restart(options)]
proceed.resolve()
await first
let said = await Promise.all(waiting)
options.run = run
// A failed handover must release the same lock for the next caller.
await assertRejects(() =>
  restart({
    ...options,
    run: () => Promise.reject(new Error('listing failed')),
  })
)
await restart(options)
await Deno.remove(concurrent, { recursive: true })

test('a restart called during another rolls once more after it, and a third coalesces', () => {
  assertEquals(said.filter((s) => s.startsWith('Coalesced')).length, 1)
  assertEquals(snapshots, [
    ['probe@old.service'],
    [starts[0]],
    [starts[1]],
  ])
  assertEquals([...active], [starts[2]])
})

test('restart queues the handover and its failure reporter without waiting for readiness', async () => {
  let launch = ['/deno', 'run', '-A', '/code/yak.ts']
  let calls: [string, string[]][] = []
  let said = await queueRestart(
    launch,
    { config: '/config/a b%".json', replace: ['yak-work'] },
    (command, args) => {
      calls.push([command, args])
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    },
  )
  assertMatch(said, /Restart queued/)
  let [command, args] = calls[0]
  assertEquals(command, 'systemd-run')
  assertEquals(args.slice(args.indexOf('--') + 1), [
    ...launch,
    '--config',
    '/config/a b%".json',
    'restart',
    '--handover',
    '--replace',
    'yak-work',
  ])
  assert(!args.includes('--wait'))
  let unit = args.find((a) => a.startsWith('--unit='))!.slice(7)
  assertMatch(unit, /^yak-restart-[0-9a-f-]{36}$/)
  assertMatch(said, new RegExp(unit))
  assertEquals(
    args.find((a) => a.startsWith('--property=ExecStopPost=')),
    `--property=ExecStopPost="/deno" "run" "-A" "/code/yak.ts" "--config" "/config/a b%%\\".json" "unit" "failure" "${unit}.service"`,
  )
})

test('a rejected background restart is reported to its caller', async () => {
  await assertRejects(
    () =>
      queueRestart(
        ['/yak'],
        {},
        () =>
          Promise.resolve({
            code: 1,
            stdout: '',
            stderr: 'job already exists',
          }),
      ),
    Error,
    'Could not queue restart: job already exists',
  )
})
