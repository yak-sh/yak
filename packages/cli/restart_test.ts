// Handover ordering and failures, with no systemd or filesystem operations.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { restart, type RestartOptions } from './restart.ts'

let fixture = () => {
  let calls: { command: string; args: string[] }[] = []
  let paths: string[] = []
  let events: string[] = []
  let elapsed = 0
  let options: RestartOptions = {
    runtimeDir: '/runtime/',
    systemctl: '/fake/systemctl',
    run: (command, args) => {
      calls.push({ command, args })
      events.push(args.includes('list-units') ? 'list' : args[2])
      return Promise.resolve({
        code: 0,
        stdout: args.includes('list-units')
          ? 'yak-work@old.service loaded active running old\n' +
            'yak-work@older.service loaded active running older\n' +
            'other.service loaded active running other\n' +
            'yak.service loaded active running web\n'
          : '',
        stderr: '',
      })
    },
    ready: (path) => {
      paths.push(path)
      events.push('ready')
      return Promise.resolve(true)
    },
    now: () => elapsed,
    sleep: (milliseconds) => {
      elapsed += milliseconds
      return Promise.resolve()
    },
  }
  return { calls, paths, events, options, elapsed: () => elapsed }
}

let candidateOf = (f: ReturnType<typeof fixture>) => {
  let candidate = f.calls[1].args[3]
  assertMatch(candidate, /^yak-work@[a-f0-9-]+\.service$/)
  return candidate
}

let fail = (f: ReturnType<typeof fixture>, action: string, unit?: string) => {
  let run = f.options.run
  assert(run)
  f.options.run = async (command, args) => {
    let result = await run(command, args)
    return args.includes(action) && (unit === undefined || args.includes(unit))
      ? { code: 1, stdout: '', stderr: `failed ${action}` }
      : result
  }
}

test('restart snapshots active workers before start and retires only after ready', async () => {
  let f = fixture()
  f.options.ready = (path) => {
    f.paths.push(path)
    f.events.push('ready')
    return Promise.resolve(f.paths.length === 3)
  }
  let candidate = await restart(f.options)
  assertEquals(candidate, candidateOf(f))
  assertEquals(f.calls.map((call) => call.command), [
    '/fake/systemctl',
    '/fake/systemctl',
    '/fake/systemctl',
    '/fake/systemctl',
  ])
  assertEquals(f.calls.map((call) => call.args), [
    [
      '--user',
      'list-units',
      '--state=active',
      '--plain',
      '--no-legend',
      '--no-pager',
      'yak-work@*.service',
      'yak-tracker.service',
      'yak-tracker@*.service',
      'yak.service',
      'yak-tracker-web.service',
    ],
    ['--user', '--no-block', 'start', candidate],
    [
      '--user',
      '--no-block',
      'stop',
      'yak-work@old.service',
      'yak-work@older.service',
    ],
    ['--user', '--no-block', 'restart', 'yak.service'],
  ])
  assertEquals(f.events, [
    'list',
    'start',
    'ready',
    'ready',
    'ready',
    'stop',
    'restart',
  ])
  let instance = candidate.slice('yak-work@'.length, -'.service'.length)
  assertEquals(f.paths, Array(3).fill(`/runtime/yak-work-${instance}.ready`))
  assertEquals(f.elapsed(), 200)
})

test('restart starts unique candidates and handles no existing workers', async () => {
  let f = fixture()
  f.options.run = (command, args) => {
    f.calls.push({ command, args })
    return Promise.resolve({ code: 0, stdout: '', stderr: '' })
  }
  let first = await restart(f.options)
  let second = await restart(f.options)
  assert(first !== second)
  assertEquals(f.calls.filter((call) => call.args.includes('stop')), [])
  assertEquals(f.calls.length, 4)
})

test('restart bounds readiness to 15 seconds and stops only its candidate', async () => {
  let f = fixture()
  f.options.ready = () => Promise.resolve(false)
  await assertRejects(
    () => restart(f.options),
    Error,
    'Timed out after 15000ms',
  )
  assertEquals(f.elapsed(), 15_000)
  assertEquals(f.calls.length, 3)
  assertEquals(f.calls[2].args, [
    '--user',
    '--no-block',
    'stop',
    candidateOf(f),
  ])
})

test('restart leaves workers untouched when listing fails', async () => {
  let f = fixture()
  fail(f, 'list-units')
  await assertRejects(() => restart(f.options), Error, 'failed list-units')
  assertEquals(f.calls.length, 1)
  assertEquals(f.paths, [])
})

test('restart cleans up a failed start without probing or restarting', async () => {
  let f = fixture()
  fail(f, 'start')
  await assertRejects(() => restart(f.options), Error, 'failed start')
  assertEquals(f.calls.length, 3)
  assertEquals(f.paths, [])
  assertEquals(f.calls[2].args, [
    '--user',
    '--no-block',
    'stop',
    candidateOf(f),
  ])
})

test('restart propagates readiness errors and stops only its candidate', async () => {
  let f = fixture()
  f.options.ready = () => Promise.reject(new Error('readiness denied'))
  await assertRejects(() => restart(f.options), Error, 'readiness denied')
  assertEquals(f.calls.length, 3)
  assertEquals(f.calls[2].args, [
    '--user',
    '--no-block',
    'stop',
    candidateOf(f),
  ])
})

test('restart keeps the ready worker when old-worker stop fails', async () => {
  let f = fixture()
  fail(f, 'stop', 'yak-work@old.service')
  await assertRejects(() => restart(f.options), Error, 'failed stop')
  assertEquals(f.calls.length, 3)
  assertEquals(
    f.calls.some((call) =>
      call.args.includes(candidateOf(f)) &&
      call.args.includes('stop')
    ),
    false,
  )
  assertEquals(f.calls.some((call) => call.args.includes('restart')), false)
})

test('restart keeps the replacement when web restart fails after old stop', async () => {
  let f = fixture()
  fail(f, 'restart')
  await assertRejects(() => restart(f.options), Error, 'failed restart')
  assertEquals(f.calls.length, 4)
  assertEquals(
    f.calls.some((call) =>
      call.args.includes(candidateOf(f)) &&
      call.args.includes('stop')
    ),
    false,
  )
  assertEquals(f.calls.filter((call) => call.args.includes('start')).length, 1)
})

test('restart returns both the handover and candidate cleanup errors', async () => {
  let f = fixture()
  fail(f, 'start')
  fail(f, 'stop')
  let error = await assertRejects(() => restart(f.options), AggregateError)
  assertEquals(error.errors.length, 2)
  assertMatch(String(error.errors[0]), /failed start/)
  assertMatch(String(error.errors[1]), /failed stop/)
  assertEquals(f.calls.length, 3)
})

test('restart rejects readiness that arrives after its deadline', async () => {
  let f = fixture()
  let sleep = f.options.sleep
  assert(sleep)
  f.options.ready = async () => {
    await sleep(15_001)
    return true
  }
  await assertRejects(
    () => restart(f.options),
    Error,
    'Timed out after 15000ms',
  )
  assertEquals(f.calls.length, 3)
  assertEquals(f.calls[2].args, [
    '--user',
    '--no-block',
    'stop',
    candidateOf(f),
  ])
})

let tracker = (f: ReturnType<typeof fixture>, legacy = true) => {
  let run = f.options.run!
  f.options.run = async (command, args) => {
    let result = await run(command, args)
    return args.includes('list-units')
      ? {
        ...result,
        stdout: result.stdout +
          `${
            legacy ? 'yak-tracker' : 'yak-tracker@old'
          }.service loaded active running tracker\n` +
          'yak-tracker-web.service loaded active running web\n',
      }
      : result
  }
}

test('restart hands over both graphs before draining either and restarts both webs', async () => {
  let f = fixture()
  tracker(f)
  let candidate = await restart(f.options)
  let next = f.calls[2].args[3]
  assertMatch(next, /^yak-tracker@[a-f0-9-]+\.service$/)
  assertEquals(f.calls.map((c) => c.args.slice(1)), [
    f.calls[0].args.slice(1),
    ['--no-block', 'start', candidate],
    ['--no-block', 'start', next],
    [
      '--no-block',
      'stop',
      'yak-work@old.service',
      'yak-work@older.service',
      'yak-tracker.service',
    ],
    ['--no-block', 'restart', 'yak.service', 'yak-tracker-web.service'],
  ])
  assertEquals(f.events, [
    'list',
    'start',
    'ready',
    'start',
    'ready',
    'stop',
    'restart',
  ])
  let instance = next.slice('yak-tracker@'.length, -'.service'.length)
  assertEquals(f.paths[1], `/runtime/yak-tracker-${instance}.ready`)
})

test('restart rolls active tracker instances on every subsequent handover', async () => {
  let f = fixture()
  tracker(f, false)
  await restart(f.options)
  assert(f.calls[3].args.includes('yak-tracker@old.service'))
  assert(!f.calls[3].args.includes('yak-tracker.service'))
})

test('failed tracker readiness leaves all old roles and the ready primary running', async () => {
  let f = fixture()
  tracker(f)
  f.options.ready = (path) => Promise.resolve(path.includes('yak-work-'))
  await assertRejects(() => restart(f.options), Error, 'Timed out')
  assertEquals(f.calls.length, 4)
  assertEquals(f.calls[3].args, [
    '--user',
    '--no-block',
    'stop',
    f.calls[2].args[3],
  ])
  assert(!f.calls.some((c) => c.args.includes('restart')))
})

test('tracker start errors are visible and clean up only the failed candidate', async () => {
  let f = fixture()
  tracker(f)
  let run = f.options.run!
  f.options.run = async (command, args) => {
    let result = await run(command, args)
    return args.includes('start') &&
        args.some((a) => a.startsWith('yak-tracker@'))
      ? { code: 5, stdout: '', stderr: 'tracker template missing' }
      : result
  }
  await assertRejects(
    () => restart(f.options),
    Error,
    'tracker template missing',
  )
  assertEquals(f.calls.length, 4)
  assertEquals(f.calls[3].args, [
    '--user',
    '--no-block',
    'stop',
    f.calls[2].args[3],
  ])
})

test('inactive or uninstalled optional roles are never started or restarted', async () => {
  let f = fixture()
  await restart(f.options)
  assert(
    !f.calls.slice(1).some((c) => c.args.some((a) => a.includes('tracker'))),
  )
})

test('tracker web enqueue failures remain visible after both pools are ready', async () => {
  let f = fixture()
  tracker(f)
  fail(f, 'restart', 'yak-tracker-web.service')
  await assertRejects(() => restart(f.options), Error, 'failed restart')
  assertEquals(f.calls.length, 5)
  assertEquals(f.calls.filter((c) => c.args.includes('stop')).length, 1)
})
