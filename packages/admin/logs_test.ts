import { test, until } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { CallError } from '@yaks/tools'
import { ram } from '@yaks/ram'
import { door as trackerDoor } from '../../workers/tracker/door.ts'
import {
  options as trackerOptions,
  platform,
  store as trackerStore,
  vocab as trackerVocab,
} from '../../workers/tracker/core.ts'
import { duration, errors, eventLine, faultsOf, records, tail } from './logs.ts'

let event = (over: Record<string, unknown> = {}) => ({
  eventTimestamp: 1000,
  outcome: 'exception',
  entrypoint: 'Directory',
  scriptVersion: { id: 'v1' },
  event: {
    request: { method: 'GET', url: 'https://yaks.app/' },
    response: { status: 500 },
  },
  exceptions: [{
    name: 'Error',
    message: 'missing kind',
    stack:
      'Error: missing kind\n    at index (worker.js:3:4)\n    at fetch (worker.js:5:6)',
  }],
  ...over,
})

test('console errors have their own timestamps and ignore other levels', () => {
  let faults = faultsOf(event({
    exceptions: [],
    logs: [
      { level: 'warn', message: ['missing kind'] },
      {
        level: 'error',
        timestamp: 3000,
        message: ['cannot index\n    at index (worker.js:3:4)'],
      },
      {
        level: 'error',
        timestamp: 2000,
        message: ['another error', { stack: 'at read (worker.js:4:5)' }],
      },
    ],
  }))
  assertEquals(faults.map((f) => [f.timestamp, f.frame]), [
    [3000, 'at index (worker.js:3:4)'],
    [2000, 'at read (worker.js:4:5)'],
  ])
  assertEquals(faults.map((f) => f.message), ['cannot index', 'another error'])
})

test('a structured Error log keeps its first frame, not the whole stack', () => {
  let [fault] = faultsOf(event({
    exceptions: [],
    logs: [{
      level: 'error',
      message: [{
        name: 'Error',
        message: 'missing kind',
        stack:
          'Error: missing kind\n    at index (worker.js:3:4)\n    at fetch (worker.js:5:6)',
      }],
    }],
  }))
  assertEquals([fault.message, fault.frame], [
    'Error: missing kind',
    'at index (worker.js:3:4)',
  ])
})

test('implicit entrypoints separate scheduled, alarm, queue and RPC errors', () => {
  let events = [
    { cron: '* * * * *' },
    { scheduledTime: 0 },
    { queue: 'mail' },
    { rpcMethod: 'index' },
  ]
  let faults = events.flatMap((trigger) =>
    faultsOf(event({ entrypoint: undefined, event: trigger }))
  )
  assertEquals(faults.map((f) => f.entrypoint), [
    'scheduled',
    'alarm',
    'queue',
    'rpc',
  ])
})

test('tail JSON tolerates pretty printing, escaped braces and arbitrary chunk boundaries', () => {
  let rows: unknown[] = []
  let parser = records((row) => rows.push(row))
  let fixture = {
    logs: [{ message: ['a {brace} and a "quote" and \\'], level: 'error' }],
  }
  let input = 'Connecting...\n' + JSON.stringify(fixture, null, 2) + '\n' +
    JSON.stringify(event())
  for (let char of input) parser.push(char)
  parser.finish()
  assertEquals(rows, [fixture, event()])
  parser.push('{"logs":')
  assertThrows(() => parser.finish(), Error, 'inside a JSON event')
})

test('tail renders one line with the door, status and exception', () => {
  assertEquals(
    eventLine(event()),
    '1970-01-01T00:00:01.000Z  exception  Directory  500 GET https://yaks.app/  Error: missing kind at index (worker.js:3:4)',
  )
  assertEquals(
    eventLine({
      eventTimestamp: 2000,
      outcome: 'ok',
      event: { scheduledTime: 'later' },
    }),
    '1970-01-01T00:00:02.000Z  ok  alarm  -',
  )
})

test('since accepts positive seconds, minutes, hours or days', () => {
  for (
    let [input, expected] of [
      ['10m', 600],
      ['1h', 3600],
      ['7', 7],
      ['30s', 30],
      ['3d', 259_200],
      ['91d', 7_862_400],
    ] as const
  ) assertEquals(duration(input), expected)
  for (let input of ['0', '-1', '1.5m', 'forever']) {
    assertThrows(() => duration(input), CallError, '--since')
  }
})

// The same signed door the deployed tracker answers, over an isolated graph.
let remote = trackerStore(ram(trackerVocab, trackerOptions), { sink: () => {} })
let ids = Array.from(
  { length: 109 },
  (_, i) => `00000000-0000-4000-8000-${String(109 - i).padStart(12, '0')}`,
)
let now = Date.now(), hour = 3_600_000
let ages = [...Array.from({ length: 105 }, (_, i) => i + 1), 8 * 24, 1, 1, -1]
await remote.graph.apply(
  ids.map((eid, i) => ({
    entity: { eid },
    doc: {
      title: i ? `Error: bug ${i}` : 'TypeError: Invalid\nredirect value',
    },
    bug: {
      fault: `admin-${i}`,
      hits: i + 1,
      first: '2026-09-25T21:35:26Z',
      last: new Date(now - ages[i] * hour).toISOString(),
    },
    ...(i == 106 ? { resolved: {} } : i == 107 ? { archived: {} } : {}),
  })),
  { trusted: true },
)
let secret = 'test-only'
let upstream = trackerDoor(remote, platform, secret)
let config = { remote: { url: 'https://tracker.test', secret } }
let go = ((url, init) => upstream(new Request(url, init))) as typeof fetch
let listed = async (
  since?: string,
  options = config,
  fetch = go,
) => {
  let said: string[] = [], noted: string[] = []
  await errors(since, options, (l) => said.push(l), (l) => noted.push(l), fetch)
  return { said, noted }
}
let bugsIn = ({ said }: Awaited<ReturnType<typeof listed>>) =>
  said.slice(1, -1).map((line) => line.split('  ')[3])

// Exercise filtering and pagination through the deployed tracker's signed door.
let all = await listed()
let narrow = await listed('90m'), wide = await listed('14d')
let denied = await listed(undefined, {
  remote: { ...config.remote, secret: 'wrong' },
}).then(() => undefined, (error) => error)

test('errors defaults to every unresolved bug however old, newest first', () => {
  assertEquals(bugsIn(all), [ids[108], ...ids.slice(0, 106)])
  assertEquals(
    all.said[0],
    'COUNT  FIRST SEEN  LAST SEEN  BUG  PLACE  MESSAGE',
  )
  assertEquals(
    all.said[2].endsWith('TypeError: Invalid redirect value'),
    true,
  )
  assertEquals(all.said.at(-1), '5780 occurrences, 107 bugs')
  assertEquals(all.noted[0].includes('107 unresolved bugs'), true)
  assertEquals(all.noted[0].includes('lifetime'), true)
})

test('errors since optionally narrows unresolved bugs by last seen', () => {
  assertEquals(bugsIn(narrow), ids.slice(0, 1))
  assertEquals(bugsIn(wide), ids.slice(0, 106))
})

test('errors refuses unavailable tracker configuration without tailing forward', async () => {
  let said: string[] = []
  await assertRejects(
    () => errors('30m', {}, (l) => said.push(l), (l) => said.push(l)),
    CallError,
    'Remote tracker is not configured',
  )
  assertEquals(said, [])
})

test('tracker refuses an invalid signing key without exposing the credential', async () => {
  await assertRejects(
    () => Promise.reject(denied),
    CallError,
    'Remote tracker refused the read',
  )
})

test('tail follows the local Wrangler stream without polling MCP', async () => {
  let was = globalThis.fetch
  let requests: string[] = [], lines: string[] = []
  globalThis.fetch = ((input: unknown) => {
    requests.push(String(input))
    throw new Error('tail must not fetch an HTTP door')
  }) as typeof fetch
  let controller: ReadableStreamDefaultController<Uint8Array>
  let stdout = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  let status = { success: true, code: 0, signal: null }
  let stopped = false, finished = false
  try {
    let following = tail(
      '/scratch',
      (line) => lines.push(line),
      () => {},
      new AbortController().signal,
      (_command, options) => {
        assertEquals(options.args?.slice(-3), ['tail', '--format', 'json'])
        assertEquals(options.cwd, '/scratch/workers/yak')
        return {
          child: {
            stdout,
            status: Promise.resolve(status),
          } as Deno.ChildProcess,
          stopped: () => false,
          stop: () => {
            stopped = true
          },
          finish: () => {
            finished = true
            return Promise.resolve()
          },
        }
      },
    )
    controller!.enqueue(
      new TextEncoder().encode(JSON.stringify(event()) + '\n'),
    )
    await until(() => lines.length == 1, { label: 'first local tail event' })
    controller!.enqueue(
      new TextEncoder().encode(
        JSON.stringify(event({ eventTimestamp: 2000 })) + '\n',
      ),
    )
    await until(() => lines.length == 2, { label: 'next local tail event' })
    controller!.close()
    assertEquals(await following, 0)
    assertEquals(requests, [])
    assertEquals(stopped && finished, true)
  } finally {
    globalThis.fetch = was
  }
})
