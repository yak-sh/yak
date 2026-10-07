// Handover ordering and failures, with no systemd or filesystem operations.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { restart, type RestartOptions } from './restart.ts'

// A box running two primary workers and a web, with no tracker; `extra`
// adds active units to what systemd lists.
let fixture = (extra: string[] = []) => {
  let calls: string[][] = []
  let paths: string[] = []
  let events: string[] = []
  let elapsed = 0
  let options: RestartOptions = {
    runtimeDir: '/runtime/',
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
  f.calls.filter((c) => c[1] == 'start').map((c) => c[2])
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

test('restart retires the old units only after every replacement is ready', async () => {
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
  assertEquals(f.events, [
    'list',
    'start',
    'ready',
    'ready',
    'start',
    'ready',
    'stop',
  ])
  assertEquals(stopped(f), [[
    'yak-work@old.service',
    'yak-work@older.service',
    'yak-web@old.service',
  ]])
  let file = (unit: string) =>
    `/runtime/${unit.replace('@', '-').replace('.service', '.ready')}`
  assertEquals(f.paths, [file(work), file(work), file(web)])
  assertEquals(
    said,
    `${work} ready in 0.1s; stopping yak-work@old.service, yak-work@older.service\n` +
      `${web} ready in 0.0s; stopping yak-web@old.service`,
  )
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

test('restart bounds readiness to 15 seconds and stops only its replacement', async () => {
  let f = fixture()
  f.options.ready = () => Promise.resolve(false)
  await assertRejects(
    () => restart(f.options),
    Error,
    'Timed out after 15000ms',
  )
  assertEquals(f.elapsed(), 15_000)
  assertEquals(stopped(f), [started(f)])
})

test('restart rejects readiness that arrives after its deadline', async () => {
  let f = fixture()
  let sleep = f.options.sleep!
  f.options.ready = async () => {
    await sleep(15_001)
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

test('a replacement that never readies leaves the old units and earlier replacements running', async () => {
  let f = fixture(['yak-tracker@old'])
  f.options.ready = (path) => Promise.resolve(!path.includes('yak-web-'))
  await assertRejects(() => restart(f.options), Error, 'Timed out')
  let [work, tracker, web] = started(f)
  assertEquals(stopped(f), [[web]])
  assert(work && tracker)
})
