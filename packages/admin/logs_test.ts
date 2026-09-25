import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { CallError } from '@yaks/tools'
import {
  duration,
  errors,
  eventLine,
  faultsOf,
  grouped,
  invocation,
  queried,
  records,
} from './logs.ts'

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

Deno.test('log signatures keep message, top frame and entrypoint; versions share a count', () => {
  let faults = [
    ...faultsOf(event({ eventTimestamp: 4000, scriptVersion: { id: 'v2' } })),
    ...faultsOf(event()),
    ...faultsOf(event({ entrypoint: 'Store' })),
    ...faultsOf(
      event({
        exceptions: [{
          name: 'Error',
          message: 'missing kind',
          stack: 'at migrate (worker.js:7:8)',
        }],
      }),
    ),
  ]
  let groups = grouped(faults)
  assertEquals(groups.length, 3)
  assertEquals(groups[0], {
    message: 'Error: missing kind',
    frame: 'at index (worker.js:3:4)',
    entrypoint: 'Directory',
    count: 2,
    first: 1000,
    last: 4000,
    versions: ['v1', 'v2'],
  })
})

Deno.test('console errors have their own timestamps and ignore other levels', () => {
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

Deno.test('structured Error logs group by the first frame, not the whole stack', () => {
  let faults = ['at fetch (worker.js:5:6)', 'at alarm (worker.js:8:9)'].flatMap(
    (caller) =>
      faultsOf(event({
        exceptions: [],
        logs: [{
          level: 'error',
          message: [{
            name: 'Error',
            message: 'missing kind',
            stack:
              `Error: missing kind\n    at index (worker.js:3:4)\n    ${caller}`,
          }],
        }],
      })),
  )
  assertEquals(grouped(faults).map((g) => [g.count, g.message, g.frame]), [[
    2,
    'Error: missing kind',
    'at index (worker.js:3:4)',
  ]])
})

Deno.test('implicit entrypoints separate scheduled, alarm, queue and RPC errors', () => {
  let events = [
    { cron: '* * * * *' },
    { scheduledTime: 0 },
    { queue: 'mail' },
    { rpcMethod: 'index' },
  ]
  let faults = events.flatMap((trigger) =>
    faultsOf(event({ entrypoint: undefined, event: trigger }))
  )
  assertEquals(grouped(faults).map((g) => g.entrypoint), [
    'scheduled',
    'alarm',
    'queue',
    'rpc',
  ])
})

Deno.test('tail JSON tolerates pretty printing, escaped braces and arbitrary chunk boundaries', () => {
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

Deno.test('tail renders one line with the door, status and exception', () => {
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

Deno.test('Workers Logs rows use the same signature as console errors in tail', () => {
  let row = queried({
    timestamp: 7000,
    $metadata: { level: 'error', message: 'cannot index' },
    $workers: { entrypoint: 'Directory', scriptVersion: { id: 'v1' } },
    source: { stack: 'Error: cannot index\n    at index (worker.js:3:4)' },
  })
  assertEquals(faultsOf(row), [{
    message: 'cannot index',
    frame: 'at index (worker.js:3:4)',
    timestamp: 7000,
    entrypoint: 'Directory',
    version: 'v1',
  }])
  assertEquals(
    faultsOf(
      queried({
        timestamp: 7000,
        $metadata: { level: 'info', message: 'fine' },
      }),
    ),
    [],
  )
  assertEquals(
    faultsOf(queried({
      timestamp: 9000,
      $metadata: { error: 'missing kind' },
      $workers: { entrypoint: 'Directory', scriptVersion: { id: 'v1' } },
      source: { exception: event().exceptions[0] },
    })),
    faultsOf(event({ eventTimestamp: 9000 })),
  )
})

Deno.test('a Workers Logs invocation row is counted, never a fault; its exception keeps the message beside it', () => {
  let meta = { level: 'error', origin: 'alarm' }
  let workers = { entrypoint: 'Store', scriptVersion: { id: 'v2' } }
  let thrown = {
    timestamp: 5000,
    $metadata: { ...meta, type: 'cf-worker', error: 'reset' },
    $workers: workers,
    source: {
      message: 'reset',
      exception: { name: 'Error', stack: '    at Object.tx (index.js:1:2)' },
    },
  }
  let summary = {
    timestamp: 5000,
    $metadata: { ...meta, type: 'cf-worker-event', error: 'Fri Sep 25 2026' },
    $workers: { ...workers, outcome: 'exception' },
    source: { level: 'error', message: 'Fri Sep 25 2026' },
  }
  assertEquals(invocation(summary), true)
  assertEquals(faultsOf(queried(summary)), [])
  assertEquals(faultsOf(queried(thrown)), [{
    message: 'Error: reset',
    frame: 'at Object.tx (index.js:1:2)',
    timestamp: 5000,
    entrypoint: 'Store',
    version: 'v2',
  }])
})

Deno.test('since accepts seconds, minutes or hours, up to a day', () => {
  for (
    let [input, expected] of [['10m', 600], ['1h', 3600], ['7', 7], [
      '30s',
      30,
    ]] as const
  ) assertEquals(duration(input), expected)
  assertEquals(duration(), 600)
  for (let input of ['0', '-1', '1.5m', 'forever', '25h']) {
    assertThrows(() => duration(input), CallError, '--since')
  }
})

Deno.test('errors without a kept token refuses with the fix, and never tails forward', async () => {
  let said: string[] = []
  let refusal = await assertRejects(
    () =>
      errors(
        '/nowhere',
        '30m',
        undefined,
        (l) => said.push(l),
        (l) => said.push(l),
      ),
    CallError,
    'cloudflare observability',
  )
  assertEquals(said, [])
  assertEquals(/yak graph apply .*op:\/\/<vault>/.test(refusal.message), true)
})
