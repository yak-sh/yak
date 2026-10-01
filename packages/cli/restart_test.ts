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
            'other.service loaded active running other\n'
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
  assertEquals(f.calls.length, 6)
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
