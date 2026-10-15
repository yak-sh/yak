import { test, until } from '@yaks/testing'
import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'
import { CallError } from '@yaks/tools'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { marksDoc } from '@yaks/kernel/vocab'
import { mailDoc } from '@yaks/mail/vocab'
import { door as trackerDoor } from '../../workers/tracker/door.ts'
import {
  options as trackerOptions,
  platform,
  store as trackerStore,
  vocab as trackerVocab,
} from '../../workers/tracker/core.ts'
import { capture } from '@yaks/tracker/report'
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
    ...(i == 106
      ? { resolved: { cause: 'A typo in the route.', recur: 'No.' } }
      : i == 107
      ? { archived: {} }
      : {}),
  })),
  { trusted: true },
)
// Occurrences name whom two bugs reached: two people, and test accounts only.
let seen = (bug: string, tags: Record<string, string>) => {
  let [row] = capture(Error('seen'), { sink: () => {}, tags })
  return { ...row, error: { ...row.error as object, bug } }
}
await remote.graph.apply([
  seen(ids[1], { user_id: 'p1', account: 'person', space: 'jill' }),
  seen(ids[1], { user_id: 'p2', account: 'person', space: 'jill' }),
  seen(ids[2], { user_id: 't1', account: 'test', space: 't1' }),
], { trusted: true })
let secret = 'test-only'
let upstream = trackerDoor(remote, platform, secret)
let config = { remote: { url: 'https://tracker.test', secret } }
let go = ((url, init) => upstream(new Request(url, init))) as typeof fetch

// The box's letters: what people wrote to the platform's addresses, and what
// left for them afterwards. Every listing below reads them, as the tool does.
let box = loadVocab([docDoc, marksDoc, mailDoc])
let mailbox = graph({ storage: ram(box), vocab: box })
let ago = (h: number) => new Date(now - h * hour).toISOString()
let got = (eid: string, from: string, h: number, more = {}) => ({
  entity: { eid },
  doc: { title: `from ${eid}` },
  mail: { from, to: 'hello@yaks.app', at: ago(h), verified: true },
  ...more,
})
let sent = (eid: string, h: number, mail: object, more = {}) => ({
  entity: { eid },
  doc: { title: `to ${eid}` },
  mail: { from: 'hello@bot.yak.sh', ...mail },
  deliver: { tried: ago(h) },
  delivered: { at: ago(h) },
  ...more,
})
await mailbox.apply([
  // Relayed feedback answers to the person who wrote it.
  got('ann', 'hello@bot.yak.sh', 5, {
    mail: {
      from: 'hello@bot.yak.sh',
      to: 'task@bot.yak.sh',
      reply_address: 'Ann@Example.com',
      at: ago(5),
      verified: true,
    },
  }),
  got('bob', 'bob@example.com', 1),
  got('carl', 'carl@example.com', 2, { archived: {} }),
  got('fay', 'fay@example.com', 4),
  got('notice', 'noreply@notify.cloudflare.com', 1),
  got('ours', 'hello@bot.yak.sh', 1),
  got('dee', 'dee@example.com', 10 * 24),
  got('eve', 'eve@example.com', 1, {
    mail: { from: 'eve@example.com', to: 'ann@example.com', at: ago(1) },
  }),
], { trusted: true })
await mailbox.apply([
  sent('ann-answer', 3, { to: 'ann@example.com', reply_to: 'ann' }),
  sent('fay-later', 0.25, { to: 'fay@example.com', reply_to: 'fay' }),
  sent('fay-answer', 0.5, { to: 'fay@example.com', reply_to: 'fay' }),
  // A letter to bob that is not a reply answers nothing.
  sent('bob-notice', 0.5, { to: 'bob@example.com' }),
], { trusted: true })

let listed = async (
  since?: string,
  options = config,
  fetch = go,
) => {
  let said: string[] = [], noted: string[] = []
  await errors(since, options, (l) => said.push(l), (l) => noted.push(l), {
    fetch,
    graph: mailbox,
  })
  return { said, noted }
}
let totalAt = (said: string[]) =>
  said.findIndex((line) => line.endsWith(' bugs') && line.includes('occurr'))
let bugsIn = ({ said }: Awaited<ReturnType<typeof listed>>) =>
  said.slice(1, totalAt(said)).map((line) => line.split('  ')[3])

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
    'COUNT  FIRST SEEN  LAST SEEN  BUG  REACHED  PLACE  MESSAGE',
  )
  assertEquals(
    all.said[2].endsWith('TypeError: Invalid redirect value'),
    true,
  )
  assertEquals(all.said[totalAt(all.said)], '5780 occurrences, 107 bugs')
  assertEquals(all.noted[0].includes('107 unresolved bugs'), true)
  assertEquals(all.noted[0].includes('lifetime'), true)
})

test('errors says whom each bug reached, a person apart from a probe', () => {
  let cell = (eid: string) =>
    all.said.find((line) => line.split('  ')[3] == eid)?.split('  ')[4]
  assertEquals(cell(ids[1]), '2 people')
  assertEquals(cell(ids[2]), 'test accounts only')
  assertEquals(cell(ids[3]), 'no person recorded')
})

test('errors times the fixes resolved in its window and the longest open bug', () => {
  let [fixed, ...rest] = all.said.slice(totalAt(all.said) + 1)
  let open = rest.find((l) => l.startsWith('Open longest'))!
  let [head, ...why] = rest.slice(0, rest.indexOf(open))
  assertMatch(head, new RegExp(`^Resolved in \\d+d\\d*h?: ${ids[106]} `))
  assertEquals(why, [
    '  What broke: Error: bug 106',
    '  Why: A typo in the route.',
    '  Fixed in: nothing changed: it stopped on its own',
    '  Can it come back: No.',
  ])
  assertMatch(
    fixed,
    new RegExp(
      `^Time to fix, resolved in the last 7d: 1 bug, median \\d+d\\d*h?, worst \\d+d\\d*h? \\(${
        ids[106]
      } Error: bug 106\\)$`,
    ),
  )
  assertMatch(open, new RegExp(`^Open longest: \\d+d\\d*h? \\(${ids[108]} `))
})

test('errors times the first answer to each person who wrote in its window', () => {
  let after = all.said.slice(
    all.said.findIndex((l) => l.startsWith('Open longest')) + 1,
  )
  assertMatch(
    after[0],
    /^People's letters in the last 7d: 4, answered 2, median 2h45m, worst 3h30m \(.+ from fay\)$/,
  )
  assertEquals(after.length, 2)
  assertMatch(after[1], /^Unanswered 1h: .+ from bob@example\.com {2}from bob$/)
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
