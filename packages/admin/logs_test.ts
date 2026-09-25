import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { CallError } from '@yaks/tools'
import { duration, errors, eventLine, faultsOf, records } from './logs.ts'

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

Deno.test('a structured Error log keeps its first frame, not the whole stack', () => {
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
  assertEquals(faults.map((f) => f.entrypoint), [
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

Deno.test('since accepts seconds, minutes, hours or days, up to 90 days', () => {
  for (
    let [input, expected] of [
      ['10m', 600],
      ['1h', 3600],
      ['7', 7],
      ['30s', 30],
      ['3d', 259_200],
    ] as const
  ) assertEquals(duration(input), expected)
  assertEquals(duration(), 600)
  for (let input of ['0', '-1', '1.5m', 'forever', '91d']) {
    assertThrows(() => duration(input), CallError, '--since')
  }
})

// Sentry's events door, answering `pages` in turn: each page's rows, and a
// Link header naming the next page's cursor while one is left.
let sentry = (pages: Record<string, unknown>[][], status = 200) => {
  let asked: Request[] = []
  let fetch = (url: string | URL | Request, init?: RequestInit) => {
    let req = new Request(url, init)
    asked.push(req)
    let at = Number(new URL(req.url).searchParams.get('cursor') ?? 0)
    let more = at + 1 < pages.length
    let link = `<x>; rel="previous"; results="false"; cursor="0:0:1", ` +
      `<x>; rel="next"; results="${more}"; cursor="${at + 1}"`
    return Promise.resolve(
      Response.json({ data: pages[at] ?? [] }, {
        status,
        headers: { link },
      }),
    )
  }
  return { fetch: fetch as typeof globalThis.fetch, asked }
}

let row = (
  issue: string,
  count: number,
  request: string | null,
  title: string,
) => ({
  issue,
  title,
  request,
  'count()': count,
  'min(timestamp)': '2026-09-25T21:35:26+00:00',
  'max(timestamp)': '2026-09-25T22:11:17+00:00',
})

let listed = async (s: ReturnType<typeof sentry>, since = '6h') => {
  let said: string[] = [], noted: string[] = []
  await errors(since, 'tok', (l) => said.push(l), (l) => noted.push(l), s.fetch)
  return { said, noted }
}

Deno.test('errors lists every issue Sentry holds for the window, across pages', async () => {
  let s = sentry([
    [row(
      'YAKS-APP-12',
      2,
      'GET /connections/callback',
      'TypeError: Invalid\nredirect value',
    )],
    [row('YAKS-APP-15', 1, null, 'Error: VPC binding failed')],
  ])
  let { said } = await listed(s)
  assertEquals(said, [
    'COUNT  FIRST SEEN  LAST SEEN  ISSUE  REQUEST  MESSAGE',
    '2  2026-09-25T21:35:26.000Z  2026-09-25T22:11:17.000Z  YAKS-APP-12  GET /connections/callback  TypeError: Invalid redirect value',
    '1  2026-09-25T21:35:26.000Z  2026-09-25T22:11:17.000Z  YAKS-APP-15  -  Error: VPC binding failed',
    '3 events, 2 issues',
  ])
  // Each page is asked with the token, for the production errors of the
  // preceding six hours, and the second one at the cursor the first named.
  assertEquals(s.asked.map((r) => r.headers.get('authorization')), [
    'Bearer tok',
    'Bearer tok',
  ])
  let [first, second] = s.asked.map((r) => new URL(r.url).searchParams)
  assertEquals(first.get('dataset'), 'errors')
  assertEquals(first.get('environment'), 'production')
  assertEquals(
    Date.parse(first.get('end')!) - Date.parse(first.get('start')!),
    6 * 3600 * 1000,
  )
  assertEquals(second.get('cursor'), '1')
  assertEquals(second.get('start'), first.get('start'))
})

Deno.test('errors without a kept token refuses with the fix, and never tails forward', async () => {
  let said: string[] = []
  let refusal = await assertRejects(
    () => errors('30m', undefined, (l) => said.push(l), (l) => said.push(l)),
    CallError,
    'sentry',
  )
  assertEquals(said, [])
  assertEquals(/yak graph apply .*op:\/\/<vault>/.test(refusal.message), true)
})

Deno.test('a token Sentry refuses is answered with the same fix', async () => {
  let refusal = await assertRejects(
    () => listed(sentry([[]], 401)),
    CallError,
    'Sentry refused the sentry token (401)',
  )
  assertEquals(/op:\/\/<vault>/.test(refusal.message), true)
})
